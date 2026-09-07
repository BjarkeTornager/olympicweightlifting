"use client";
import * as Primitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { X } from "@/components/ui/icons";
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onCloseAutoFocus,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  onCloseAutoFocus?: ComponentProps<
    typeof Primitive.Content
  >["onCloseAutoFocus"];
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="dialog-overlay" />
        <Primitive.Content
          className={["dialog-content", className].filter(Boolean).join(" ")}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <Primitive.Title className="dialog-title">{title}</Primitive.Title>
          <Primitive.Description className={description ? "muted" : "sr-only"}>
            {description ?? title}
          </Primitive.Description>
          {children}
          <Primitive.Close className="dialog-close" aria-label="Close">
            <X size={20} aria-hidden="true" />
          </Primitive.Close>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
