// iOS browsers may shrink innerHeight along with visualViewport.height, or pan
// the viewport while the keyboard animates. A single inset comparison misses both.
export function trackKeyboardViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let width = window.innerWidth;
  let closedHeight = Math.max(window.innerHeight, viewport?.height ?? 0);
  let open = false;
  let frame = 0;
  let composerBlurAt = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const refresh = () => {
    frame = 0;
    const height = viewport?.height ?? window.innerHeight;
    const top = viewport?.offsetTop ?? 0;
    if (height <= 0) return;
    const element = document.activeElement;
    const editing =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement;
    const scale = viewport?.scale ?? 1;
    const unzoomed = Math.abs(scale - 1) < 0.05;
    if (Math.abs(width - window.innerWidth) > 50) {
      // Don't retain a portrait baseline after rotation or a desktop resize.
      width = window.innerWidth;
      closedHeight = Math.max(window.innerHeight, height);
    }
    if (!editing && !open && unzoomed)
      closedHeight = Math.max(window.innerHeight, height);
    const loss = Math.max(window.innerHeight, closedHeight) - height;
    const inset = Math.max(0, window.innerHeight - height - top);
    const compactOnFocus =
      window.innerWidth <= 768 &&
      height < 400 &&
      ((editing && !!element.closest(".agent-composer")) ||
        (open && Date.now() - composerBlurAt < 500));
    // Keep the layout through blur until the viewport recovers: Send must not
    // move between pointer-down and click. A small viewport also gets a fallback.
    open = unzoomed && ((loss > 150 && (editing || open)) || compactOnFocus);
    root.toggleAttribute("data-keyboard-open", open);
    root.style.setProperty("--coach-viewport-height", `${height}px`);
    root.style.setProperty("--coach-viewport-top", `${top}px`);
    root.style.setProperty("--keyboard-inset", `${open ? inset : 0}px`);
    if (
      open &&
      element instanceof HTMLElement &&
      !element.closest(".coach-mode")
    ) {
      const bounds = element.getBoundingClientRect();
      if (bounds.bottom > top + height - 90 || bounds.top < top)
        element.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(refresh);
  };
  const focusChanged = (event: FocusEvent) => {
    if (
      event.type === "focusout" &&
      event.target instanceof Element &&
      event.target.closest(".agent-composer")
    )
      composerBlurAt = Date.now();
    schedule();
    // Some embedded iOS browsers report the new viewport after focus without a
    // resize event. Read again during the keyboard animation, never poll forever.
    for (const delay of [100, 350, 700]) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        schedule();
      }, delay);
      timers.add(timer);
    }
  };
  refresh();
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("focusin", focusChanged);
  window.addEventListener("focusout", focusChanged);
  return () => {
    cancelAnimationFrame(frame);
    timers.forEach(clearTimeout);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("focusin", focusChanged);
    window.removeEventListener("focusout", focusChanged);
    root.removeAttribute("data-keyboard-open");
    for (const property of [
      "--keyboard-inset",
      "--coach-viewport-height",
      "--coach-viewport-top",
    ])
      root.style.removeProperty(property);
  };
}
