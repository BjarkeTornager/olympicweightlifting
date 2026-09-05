import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import type { ComponentProps } from "react";
const variants = cva("button", {
  variants: {
    variant: {
      default: "",
      secondary: "button-secondary",
      ghost: "button-ghost",
      danger: "button-danger",
      gold: "button-gold",
    },
  },
  defaultVariants: { variant: "default" },
});
export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={clsx(variants({ variant }), className)} {...props} />;
}
