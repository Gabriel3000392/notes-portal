import type { Course, LectureSeed, PortalState } from './types'

export function compareLecturesByDate(a: LectureSeed, b: LectureSeed) {
  const dateCompare = a.date.localeCompare(b.date)
  if (dateCompare !== 0) return dateCompare
  return a.title.localeCompare(b.title)
}

export function sortCourseLectures(course: Course): Course {
  return {
    ...course,
    lectures: [...course.lectures].sort(compareLecturesByDate),
  }
}

export function sortPortalStateLectures(state: PortalState): PortalState {
  return {
    ...state,
    courses: state.courses.map(sortCourseLectures),
  }
}
