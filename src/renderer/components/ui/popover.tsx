/**
 * Popover Component
 *
 * Enterprise-grade popover component built on Radix UI primitives.
 * Supports proper positioning inside scrollable containers like Dialogs.
 */

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "../../lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

interface PopoverContentProps extends React.ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
> {
  /**
   * Container element for the portal. Use this when the Popover is inside
   * a scrollable container (like a Dialog) to ensure proper positioning.
   * If not provided, uses the default document.body.
   */
  container?: HTMLElement | null;
  /**
   * Whether to render inside a portal.
   * Set to false when inside a Dialog to avoid positioning issues.
   * @default true
   */
  usePortal?: boolean;
}

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(
  (
    {
      className,
      align = "center",
      sideOffset = 4,
      container,
      usePortal = true,
      ...props
    },
    ref,
  ) => {
    const content = (
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        // Fix positioning inside scrollable containers (Dialogs)
        collisionPadding={16}
        avoidCollisions={true}
        sticky="always"
        updatePositionStrategy="always"
        className={cn(
          "z-[100] w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
    );

    // When usePortal is false, render without portal for proper positioning in Dialogs
    if (!usePortal) {
      return content;
    }

    return (
      <PopoverPrimitive.Portal container={container}>
        {content}
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
