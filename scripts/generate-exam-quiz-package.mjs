#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

const questionTextPath = process.argv[2]
const answerTextPath = process.argv[3] && !process.argv[3].startsWith('--')
  ? process.argv[3]
  : null
const outputPathArg = process.argv.find((arg) => arg.startsWith('--out='))
const outputPath = resolve(outputPathArg?.slice('--out='.length) ?? 'exam-quiz-package.json')

if (!questionTextPath) {
  console.error(
    'Usage: node scripts/generate-exam-quiz-package.mjs question.txt [answers.txt] --out=package.json',
  )
  process.exit(1)
}

const questionText = await readFile(questionTextPath, 'utf8')
const answerText = answerTextPath ? await readFile(answerTextPath, 'utf8') : ''
const questionBlocks = parseMultipleChoiceQuestions(questionText)
const answerBlocks = answerText ? parseMultipleChoiceQuestions(answerText) : []
const answersByNumber = new Map(answerBlocks.map((block) => [block.number, block]))
const exam = examMetadata(questionTextPath, questionText)
const warnings = []

const questions = questionBlocks.map((block) => {
  const answerBlock = answersByNumber.get(block.number)
  const answerLetter = answerBlock?.correctLetter ?? block.correctLetter ?? null
  const hasExtractedOptions = block.options.length >= 2
  const options = hasExtractedOptions
    ? block.options
    : ['a', 'b', 'c', 'd', 'e'].map((letter) => ({
        letter,
        text: `Option ${letter} shown in the source diagram`,
      }))
  const correctOption = answerLetter
    ? options.find((option) => option.letter === answerLetter)
    : null
  const missingAnswer = !correctOption || !hasExtractedOptions

  if (missingAnswer) {
    warnings.push(
      `${exam.title} Q${block.number}: no machine-readable answer key found; answer needs review.`,
    )
  }
  if (!hasExtractedOptions) {
    warnings.push(
      `${exam.title} Q${block.number}: options were not text-extractable; source diagram image required.`,
    )
  }

  return {
    type: 'multiple_choice',
    originalType: 'multiple_choice',
    prompt: block.prompt,
    options: options.map((option) => `${option.letter}) ${option.text}`),
    correctAnswer: correctOption
      ? `${correctOption.letter}) ${correctOption.text}`
      : 'Needs review',
    explanation: answerBlock?.explanation || 'Answer explanation not available in extracted text.',
    marks: block.marks,
    topics: inferTopics(block.prompt),
    assets: hasExtractedOptions
      ? []
      : [
          {
            id: `${exam.slug}-q${block.number}-source`,
            kind: 'source_crop',
            label: `Source diagram for Q${block.number}`,
            url: `/exam-assets/${exam.slug}-page-${block.page}.png`,
            alt: `Source page image for ${exam.title} question ${block.number}`,
            source: basename(questionTextPath).replace(/\.txt$/i, '.pdf'),
            confidence: 'needs_review',
          },
        ],
    sourceRef: {
      paper: basename(questionTextPath).replace(/\.txt$/i, '.pdf'),
      page: block.page,
      question: String(block.number),
      answerPaper: answerTextPath ? basename(answerTextPath).replace(/\.txt$/i, '.pdf') : undefined,
    },
    answerSource: answerLetter
      ? `Answer extracted from ${basename(answerTextPath ?? questionTextPath)} as option ${answerLetter}.`
      : '',
    convertedToMultipleChoice: false,
    confidence: missingAnswer ? 'needs_review' : 'verified',
  }
})

const pkg = {
  source: {
    system: 'exam_prep',
    id: exam.slug,
    generatedAt: new Date().toISOString(),
    files: [
      { path: questionTextPath, role: 'questions' },
      ...(answerTextPath ? [{ path: answerTextPath, role: 'answers' }] : []),
    ],
  },
  course: {
    code: 'CHEM111',
    title: 'Chemical Principles and Processes',
    term: exam.semester ? `${exam.year ?? 'Unknown'} ${exam.semester}` : String(exam.year ?? 'Exam prep'),
  },
  exam,
  quiz: {
    title: `${exam.title} multiple choice`,
    questions,
  },
  audit: {
    warnings,
    questionCount: questions.length,
    verifiedAnswers: questions.filter((question) => question.confidence === 'verified').length,
  },
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
console.log(
  `Wrote ${outputPath}: ${questions.length} questions, ${pkg.audit.verifiedAnswers} verified answers, ${warnings.length} warnings.`,
)

function parseMultipleChoiceQuestions(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let current = null
  let currentOption = null
  let page = 1
  let inInstructions = true

  for (const rawLine of lines) {
    if (rawLine.includes('\f')) page += 1
    const line = rawLine.replace(/\f/g, '').trimEnd()
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^For each question/i.test(trimmed)) inInstructions = false

    const questionMatch =
      trimmed.match(/^([A-Z]\d{1,3})\.\s*(.*)$/) ??
      trimmed.match(/^(\d{1,3})\.\s{2,}(.*)$/)
    if (questionMatch && !inInstructions) {
      finishQuestion()
      current = {
        number: questionMatch[1],
        page,
        marks: 1,
        promptLines: [],
        options: [],
        explanationLines: [],
        correctLetter: null,
      }
      currentOption = null
      const firstLine = questionMatch[2].trim()
      if (/^\(?2 marks\)?$/i.test(firstLine)) current.marks = 2
      else if (firstLine) current.promptLines.push(firstLine)
      continue
    }

    if (!current) continue
    if (/^\(?2 marks\)?$/i.test(trimmed)) {
      current.marks = 2
      continue
    }

    const optionMatch = trimmed.match(/^([a-e])\)\s*(.*)$/i)
    if (optionMatch) {
      currentOption = {
        letter: optionMatch[1].toLowerCase(),
        lines: [optionMatch[2].trim()],
      }
      current.options.push(currentOption)
      continue
    }

    const correctMatch = trimmed.match(/correct answer\s+([a-e])/i)
    if (correctMatch) current.correctLetter = correctMatch[1].toLowerCase()

    if (current.options.length === 0) current.promptLines.push(trimmed)
    else if (currentOption && !/^Calculation for correct answer/i.test(trimmed) && !/^Answer [a-e]/i.test(trimmed)) {
      currentOption.lines.push(trimmed)
    } else {
      current.explanationLines.push(trimmed)
    }
  }

  finishQuestion()
  return blocks

  function finishQuestion() {
    if (!current) return
    blocks.push({
      number: current.number,
      page: current.page,
      marks: current.marks,
      prompt: cleanText(current.promptLines.join(' ')),
      options: current.options.map((option) => ({
        letter: option.letter,
        text: cleanText(option.lines.join(' ')),
      })),
      explanation: cleanText(current.explanationLines.join(' ')),
      correctLetter: current.correctLetter,
    })
  }
}

function cleanText(value) {
  return value
    .replace(/\s+/g, ' ')
    .replaceAll('', 'x')
    .replaceAll('–', '-')
    .trim()
}

function examMetadata(filePath, text) {
  const name = basename(filePath).replace(/\.txt$/i, '')
  const year = Number(name.match(/20\d{2}/)?.[0] ?? text.match(/20\d{2}/)?.[0]) || null
  const semester = /S1/i.test(name) ? 'S1' : /S2|Sept|September/i.test(name) ? 'S2' : null
  const assessment = /exam/i.test(name) ? 'exam' : 'test'
  const slug = [
    'chem111',
    year ?? 'unknown-year',
    semester?.toLowerCase() ?? 'unknown-semester',
    assessment,
  ].join('-')
  return {
    slug,
    title: `CHEM111 ${year ?? ''} ${semester ?? ''} ${assessment}`.replace(/\s+/g, ' ').trim(),
    year,
    semester,
    assessment,
  }
}

function inferTopics(prompt) {
  const lower = prompt.toLowerCase()
  const topics = []
  if (/mole|mol|mass|titr|concentration|volumetric|aliquot/.test(lower)) topics.push('stoichiometry')
  if (/electron|orbital|quantum|ionisation|isotope|atomic/.test(lower)) topics.push('atomic structure')
  if (/bond|vsepr|lewis|resonance|hypervalent|electronegativity/.test(lower)) topics.push('bonding')
  if (/gas|pressure|volume|temperature|ideal|boyle|dalton/.test(lower)) topics.push('gases')
  if (/enthalpy|heat|thermo|calor|internal energy/.test(lower)) topics.push('thermochemistry')
  if (/acid|base|ph|hcl|naoh/.test(lower)) topics.push('acid-base')
  if (/redox|oxidation|reduction/.test(lower)) topics.push('redox')
  return topics.length ? topics : ['exam practice']
}
