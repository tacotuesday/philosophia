import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { clozes, localDate } from '../shared/model'
export const call = window.desk.invoke
export const prettyDay = (
  day: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
) => localDate(day).toLocaleDateString(undefined, options)
export const domain = (source: string) => {
  try {
    return new URL(source).hostname.replace(/^www\./, '')
  } catch {
    return source
  }
}
export type Task = (fn: () => Promise<void>) => void
export function ClozeText({
  text,
  group,
  reveal = false
}: {
  text: string
  group: number
  reveal?: boolean
}) {
  return (
    <>
      {clozes(text).map((p, i) =>
        p.group === group ? (
          <mark className={'cloze ' + (reveal ? 'answer' : '')} key={i}>
            {reveal ? p.text : p.hint || '[…]'}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  )
}
export function Modal({
  title,
  close,
  children
}: {
  title: string
  close: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} onCancel={close}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon" aria-label="Close dialog" onClick={close}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
export function Empty({
  title,
  children
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  )
}
