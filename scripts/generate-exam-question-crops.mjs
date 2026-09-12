#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

const outputDir = resolve(process.argv[2] ?? '../Exam prep/Chem111/output')
const pdfDir = resolve(process.argv[3] ?? '../Exam prep/Chem111/Tests')
const assetDir = resolve(process.argv[4] ?? 'public/exam-assets')
const dpi = Number(process.env.EXAM_CROP_DPI ?? 220)
const margin = {
  left: 14,
  top: 10,
  right: 14,
  bottom: 8,
}

await mkdir(assetDir, { recursive: true })

const packages = (await readdir(outputDir))
  .filter((file) => file.endsWith('.quiz.json'))
  .sort()

let updatedQuestions = 0
let generatedImages = 0
const warnings = []

for (const packageFile of packages) {
  const packagePath = join(outputDir, packageFile)
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
  const questionsNeedingCrops = pkg.quiz.questions.filter((question) =>
    (question.assets ?? []).some((asset) => asset.url?.includes('-page-')),
  )

  if (!questionsNeedingCrops.length) continue

  const pdfByName = await resolvePdfs(pdfDir)
  const paperName = questionsNeedingCrops[0]?.sourceRef?.paper
  const pdfPath = pdfByName.get(paperName)
  if (!pdfPath) {
    warnings.push(`${packageFile}: missing source PDF ${paperName}`)
    continue
  }

  const layout = extractPdfLayout(pdfPath)
  const questionPositions = new Map()
  for (const question of pkg.quiz.questions) {
    const page = Number(question.sourceRef?.page)
    const label = String(question.sourceRef?.question ?? '')
    const position = findQuestionLabel(layout.pages[page - 1], label)
    if (position) questionPositions.set(questionKey(page, label), position)
  }

  for (const question of questionsNeedingCrops) {
    const pageNumber = Number(question.sourceRef?.page)
    const label = String(question.sourceRef?.question ?? '')
    const page = layout.pages[pageNumber - 1]
    const position = questionPositions.get(questionKey(pageNumber, label))

    if (!page || !position) {
      warnings.push(`${packageFile} Q${label}: could not locate question on page ${pageNumber}`)
      continue
    }

    const nextPosition = [...questionPositions.entries()]
      .filter(([key, item]) => key.startsWith(`${pageNumber}:`) && item.yMin > position.yMin + 2)
      .map(([, item]) => item)
      .sort((a, b) => a.yMin - b.yMin)[0]

    const crop = {
      xMin: Math.max(0, Math.min(position.xMin, 45) - margin.left),
      yMin: Math.max(0, position.yMin - margin.top),
      xMax: Math.min(page.width, page.width - margin.right),
      yMax: Math.min(page.height, (nextPosition?.yMin ?? page.contentBottom) - margin.bottom),
    }

    if (crop.yMax <= crop.yMin + 20) {
      warnings.push(`${packageFile} Q${label}: crop bounds were too small on page ${pageNumber}`)
      continue
    }

    const safeQuestion = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const fileName = `${pkg.exam.slug}-q-${safeQuestion}.png`
    const filePath = join(assetDir, fileName)
    renderCrop(pdfPath, pageNumber, crop, filePath)
    generatedImages += 1

    const primaryAsset = {
      id: `${pkg.exam.slug}-q-${safeQuestion}-source`,
      kind: 'source_crop',
      label: `Source diagram/options for Q${label}`,
      url: `/exam-assets/${fileName}`,
      alt: `Question-specific source crop for ${pkg.exam.title} question ${label}`,
      source: paperName,
      confidence: 'verified',
    }

    question.assets = [
      primaryAsset,
      ...(question.assets ?? []).filter((asset) => !asset.url?.includes('-page-')),
    ]
    updatedQuestions += 1
  }

  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
}

console.log(
  `Generated ${generatedImages} question crops and updated ${updatedQuestions} questions across ${packages.length} packages.`,
)
if (warnings.length) {
  console.warn('Warnings:')
  for (const warning of warnings) console.warn(`- ${warning}`)
}

async function resolvePdfs(directory) {
  const files = await readdir(directory)
  return new Map(
    files
      .filter((file) => file.toLowerCase().endsWith('.pdf'))
      .map((file) => [file, join(directory, file)]),
  )
}

function extractPdfLayout(pdfPath) {
  const html = execFileSync('pdftotext', ['-bbox-layout', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  })

  const pages = []
  const pagePattern = /<page width="([^"]+)" height="([^"]+)">([\s\S]*?)<\/page>/g
  let pageMatch
  while ((pageMatch = pagePattern.exec(html))) {
    const words = []
    const wordPattern =
      /<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([\s\S]*?)<\/word>/g
    let wordMatch
    while ((wordMatch = wordPattern.exec(pageMatch[3]))) {
      words.push({
        xMin: Number(wordMatch[1]),
        yMin: Number(wordMatch[2]),
        xMax: Number(wordMatch[3]),
        yMax: Number(wordMatch[4]),
        text: decodeHtml(wordMatch[5]),
      })
    }
    const contentBottom = Math.min(
      Number(pageMatch[2]),
      Math.max(80, ...words.map((word) => word.yMax)) + 18,
    )
    pages.push({
      width: Number(pageMatch[1]),
      height: Number(pageMatch[2]),
      contentBottom,
      words,
    })
  }

  return { pages }
}

function findQuestionLabel(page, label) {
  if (!page) return null
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`^${escaped}\\.$`, 'i'),
    new RegExp(`^${escaped}$`, 'i'),
  ]
  return page.words.find((word) => patterns.some((pattern) => pattern.test(word.text.trim()))) ?? null
}

function renderCrop(pdfPath, pageNumber, crop, filePath) {
  const scale = dpi / 72
  const args = [
    '-r',
    String(dpi),
    '-png',
    '-f',
    String(pageNumber),
    '-l',
    String(pageNumber),
    '-singlefile',
    '-x',
    String(Math.round(crop.xMin * scale)),
    '-y',
    String(Math.round(crop.yMin * scale)),
    '-W',
    String(Math.round((crop.xMax - crop.xMin) * scale)),
    '-H',
    String(Math.round((crop.yMax - crop.yMin) * scale)),
    pdfPath,
    filePath.replace(/\.png$/i, ''),
  ]
  execFileSync('pdftoppm', args, { stdio: 'pipe' })
  if (!existsSync(filePath)) {
    throw new Error(`pdftoppm did not create ${filePath}`)
  }
}

function questionKey(page, label) {
  return `${page}:${label}`
}

function decodeHtml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}
