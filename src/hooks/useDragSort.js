import { useRef, useState } from 'react'

/**
 * useDragSort – shared drag-to-reorder hook with smooth edge-scroll.
 *
 * @param {Function} setItems  React state setter for the list array
 * @returns drag event handlers + draggedIdx (for "dragging" CSS class)
 *
 * Auto-scroll: when the cursor is within 10% of viewport height from the
 * top or bottom edge, the page scrolls at a speed proportional to how
 * close the cursor is to the edge (max ~14 px/frame). Uses rAF so the
 * scroll is buttery smooth and stops immediately on dragend.
 */
export function useDragSort(setItems) {
  const [draggedIdx, setDraggedIdx] = useState(null)

  // Ref for the live dragged index — avoids stale closure in dragover
  const liveIdx = useRef(null)

  // rAF auto-scroll state
  const rafId    = useRef(null)
  const scrollPx = useRef(0)   // pixels/frame to scroll (negative = up)

  // ── Auto-scroll helpers ───────────────────────────────────────────────────

  function startScroll(pxPerFrame) {
    scrollPx.current = pxPerFrame
    if (rafId.current) return          // already running
    function tick() {
      window.scrollBy(0, scrollPx.current)
      rafId.current = requestAnimationFrame(tick)
    }
    rafId.current = requestAnimationFrame(tick)
  }

  function stopScroll() {
    if (rafId.current) {
      cancelAnimationFrame(rafId.current)
      rafId.current = null
    }
    scrollPx.current = 0
  }

  /** Call this from every onDragOver handler with the event's clientY */
  function updateScroll(clientY) {
    const h         = window.innerHeight
    const threshold = h * 0.10          // 10% of viewport height

    if (clientY < threshold) {
      // Near top → scroll up; stronger as cursor approaches edge
      const ratio = 1 - clientY / threshold
      startScroll(-Math.ceil(ratio * 14))
    } else if (clientY > h - threshold) {
      // Near bottom → scroll down
      const ratio = 1 - (h - clientY) / threshold
      startScroll(Math.ceil(ratio * 14))
    } else {
      stopScroll()
    }
  }

  // ── Drag event handlers ───────────────────────────────────────────────────

  function onDragStart(e, idx) {
    liveIdx.current = idx
    setDraggedIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }

  function onDragOver(e, idx) {
    e.preventDefault()
    updateScroll(e.clientY)

    if (idx === undefined || idx === null) return

    const from = liveIdx.current
    if (from === null || from === idx) return

    setItems(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(idx, 0, item)
      return next
    })

    liveIdx.current = idx
    setDraggedIdx(idx)
  }

  function onDragEnd() {
    stopScroll()
    liveIdx.current = null
    setDraggedIdx(null)
  }

  return { draggedIdx, onDragStart, onDragOver, onDragEnd }
}
