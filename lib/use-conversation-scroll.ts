"use client";
import { useCallback, useLayoutEffect, useRef } from "react";

// Keep the latest exchange anchored through keyboard animation, late replies,
// image layout and temporary session concealment. Reading older messages wins
// over automatic scrolling until the user sends again or chooses Latest.
export function useConversationScroll(
  newestId: string | undefined,
  active: boolean,
) {
  const conversation = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const readingTop = useRef(0);
  const concealed = useRef(false);
  const frame = useRef(0);
  const restore = useCallback(() => {
    const scroller = conversation.current;
    if (!scroller) return;
    if (!scroller.clientHeight) {
      concealed.current = true;
      return;
    }
    const padding = getComputedStyle(scroller);
    // A short outgoing message must have room to stay at the top while the
    // keyboard closes, before the assistant's answer has arrived.
    scroller.style.setProperty(
      "--conversation-space",
      `${Math.max(
        0,
        scroller.clientHeight -
          parseFloat(padding.paddingTop) -
          parseFloat(padding.paddingBottom),
      )}px`,
    );
    const latest = content.current?.lastElementChild;
    if (following.current && latest?.classList.contains("conversation-turn")) {
      scroller.scrollTop +=
        latest.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        16;
      readingTop.current = scroller.scrollTop;
    } else if (concealed.current) {
      scroller.scrollTop = readingTop.current;
    }
    concealed.current = false;
  }, []);
  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(restore);
  }, [restore]);
  const showLatest = useCallback(() => {
    following.current = true;
    schedule();
  }, [schedule]);
  const readHistory = useCallback(() => {
    following.current = false;
  }, []);
  const remember = useCallback(() => {
    if (conversation.current?.clientHeight)
      readingTop.current = conversation.current.scrollTop;
  }, []);
  useLayoutEffect(() => {
    if (active && newestId) showLatest();
  }, [active, newestId, showLatest]);
  useLayoutEffect(() => {
    const scroller = conversation.current,
      messages = content.current;
    if (!scroller || !messages) return;
    const observer = new ResizeObserver(() => {
      // Record concealment synchronously; a quick hide/show may share a frame.
      if (!scroller.clientHeight) concealed.current = true;
      schedule();
    });
    observer.observe(scroller);
    observer.observe(messages);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame.current);
    };
  }, [schedule]);
  return { conversation, content, showLatest, readHistory, remember };
}
