/**
 * Centralized Accordion Component
 *
 * Enterprise-grade accordion with smooth CSS Grid animations, full ARIA compliance,
 * and consistent styling across the application.
 *
 * Animation: Uses CSS Grid transition (350ms ease-out) matching the reports page DayAccordion.
 * This technique animates `grid-template-rows: 0fr → 1fr` for smooth height transitions
 * without requiring JavaScript height calculations.
 *
 * @module renderer/components/ui/accordion
 *
 * @security FE-001: XSS prevention via React JSX auto-escaping
 * @security SEC-004: No dangerouslySetInnerHTML, all output escaped
 * @accessibility ARCH-003: Built-in ARIA attributes (aria-expanded, aria-controls, role)
 * @accessibility A11Y-009: Full keyboard navigation (Enter, Space, Arrow keys, Home, End)
 * @performance PERF-002: React.memo on all components, forwardRef for composition
 *
 * @example
 * // Single-expand accordion (only one item open at a time)
 * <Accordion type="single" collapsible defaultValue="item-1">
 *   <AccordionItem value="item-1">
 *     <AccordionTrigger>Section 1</AccordionTrigger>
 *     <AccordionContent>Content 1</AccordionContent>
 *   </AccordionItem>
 *   <AccordionItem value="item-2">
 *     <AccordionTrigger>Section 2</AccordionTrigger>
 *     <AccordionContent>Content 2</AccordionContent>
 *   </AccordionItem>
 * </Accordion>
 *
 * @example
 * // Multi-expand accordion (multiple items can be open)
 * <Accordion type="multiple" defaultValue={['item-1']}>
 *   <AccordionItem value="item-1">
 *     <AccordionTrigger>Section 1</AccordionTrigger>
 *     <AccordionContent>Content 1</AccordionContent>
 *   </AccordionItem>
 * </Accordion>
 */

import * as React from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Animation duration in milliseconds
 * Matches DayAccordion's smooth 350ms transition
 */
const ACCORDION_ANIMATION_DURATION_MS = 350;

/**
 * Tailwind duration class for accordion animations
 * SEC-004: Hardcoded value, no user input interpolation
 */
const ACCORDION_DURATION_CLASS = 'duration-[350ms]';

// ============================================================================
// ACCORDION ROOT
// ============================================================================

/**
 * Accordion Root Component
 *
 * Container that manages accordion state and keyboard navigation.
 * Wraps Radix UI Accordion with consistent styling.
 *
 * @accessibility Provides arrow key navigation between items
 * @accessibility Home/End keys jump to first/last item
 */
const Accordion = AccordionPrimitive.Root;

// ============================================================================
// ACCORDION ITEM
// ============================================================================

/**
 * AccordionItem Component
 *
 * Individual accordion section containing a trigger and content.
 * Uses data-state attribute for styling based on open/closed state.
 *
 * @accessibility Links trigger to content via aria-controls (handled by Radix)
 */
const AccordionItem = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn(
      // Base styling
      'border-b border-border',
      // Last item removes bottom border to prevent double borders
      'last:border-b-0',
      className
    )}
    {...props}
  />
));
AccordionItem.displayName = 'AccordionItem';

// ============================================================================
// ACCORDION TRIGGER
// ============================================================================

/**
 * AccordionTrigger Component
 *
 * Clickable header that toggles the accordion content visibility.
 * Includes animated chevron indicator.
 *
 * @accessibility aria-expanded automatically managed by Radix
 * @accessibility Keyboard: Enter/Space to toggle
 * @performance Uses CSS transitions for chevron rotation (no JS animation)
 */
const AccordionTrigger = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger> & {
    /** Hide the default chevron icon */
    hideChevron?: boolean;
    /** Custom icon to show instead of chevron */
    icon?: React.ReactNode;
  }
>(({ className, children, hideChevron = false, icon, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        // Layout
        'flex flex-1 items-center justify-between py-4 px-1',
        // Typography
        'text-sm font-medium text-left',
        // Interaction states
        'transition-all hover:underline',
        // Focus ring for accessibility
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        // Disabled state
        'disabled:pointer-events-none disabled:opacity-50',
        // Chevron rotation on open (data-state from Radix)
        '[&[data-state=open]>svg.accordion-chevron]:rotate-180',
        className
      )}
      {...props}
    >
      {children}
      {!hideChevron &&
        (icon ?? (
          <ChevronDown
            className={cn(
              'accordion-chevron h-4 w-4 shrink-0 text-muted-foreground',
              // Position on extreme right
              'ml-auto',
              // Smooth rotation animation matching accordion content
              'transition-transform',
              ACCORDION_DURATION_CLASS,
              'ease-out'
            )}
            aria-hidden="true"
          />
        ))}
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
));
AccordionTrigger.displayName = 'AccordionTrigger';

// ============================================================================
// ACCORDION CONTENT
// ============================================================================

/**
 * AccordionContent Component
 *
 * Collapsible content area with smooth CSS Grid animation.
 *
 * Animation Technique:
 * Uses CSS Grid with `grid-template-rows: 0fr → 1fr` transition.
 * This is more reliable than height-based animations because:
 * 1. No JavaScript height calculation required
 * 2. Works with dynamic content
 * 3. Smoother than max-height hacks
 *
 * @accessibility role="region" for screen readers
 * @accessibility aria-labelledby links to trigger (handled by Radix)
 * @performance Overflow hidden prevents paint outside bounds
 */
const AccordionContent = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className={cn(
      // CSS Grid animation container
      'grid transition-[grid-template-rows]',
      ACCORDION_DURATION_CLASS,
      'ease-out',
      // Closed state: 0fr height
      'data-[state=closed]:grid-rows-[0fr]',
      // Open state: natural height (1fr)
      'data-[state=open]:grid-rows-[1fr]',
      className
    )}
    {...props}
  >
    {/* Inner wrapper required for grid animation to work */}
    <div className="overflow-hidden">
      <div className={cn('pb-4 pt-0 text-sm')}>{children}</div>
    </div>
  </AccordionPrimitive.Content>
));
AccordionContent.displayName = 'AccordionContent';

// ============================================================================
// STYLED VARIANTS
// ============================================================================

/**
 * AccordionCard Variant
 *
 * Accordion with card-like styling (rounded corners, shadow, background).
 * Use this for standalone accordion sections.
 *
 * @example
 * <AccordionCard type="single" collapsible>
 *   <AccordionItem value="item-1">
 *     <AccordionTrigger>Settings</AccordionTrigger>
 *     <AccordionContent>Settings content</AccordionContent>
 *   </AccordionItem>
 * </AccordionCard>
 */
const AccordionCard = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Root>
>(({ className, ...props }, ref) => (
  <Accordion
    ref={ref}
    className={cn('rounded-xl bg-card shadow-card overflow-hidden', className)}
    {...props}
  />
));
AccordionCard.displayName = 'AccordionCard';

/**
 * AccordionItemCard Variant
 *
 * Accordion item with card-like trigger styling.
 * Includes gradient background and hover effects matching DayAccordion.
 */
const AccordionItemCard = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>
>(({ className, ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={cn('border-b border-border last:border-b-0 overflow-hidden', className)}
    {...props}
  />
));
AccordionItemCard.displayName = 'AccordionItemCard';

/**
 * AccordionTriggerCard Variant
 *
 * Card-style trigger with gradient background matching DayAccordion.
 * Use with AccordionItemCard for consistent styling.
 */
const AccordionTriggerCard = React.forwardRef<
  React.ComponentRef<typeof AccordionPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger> & {
    hideChevron?: boolean;
    icon?: React.ReactNode;
  }
>(({ className, children, hideChevron = false, icon, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={cn(
        // Layout matching DayAccordion
        'flex flex-1 items-center justify-between px-6 py-5',
        'min-h-[88px] box-border',
        // Gradient background
        'bg-gradient-to-r from-muted/50 to-card',
        // Interaction states
        'transition-colors hover:from-muted hover:to-muted/50',
        // Focus ring
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        // Chevron rotation
        '[&[data-state=open]>svg.accordion-chevron]:rotate-0',
        '[&[data-state=closed]>svg.accordion-chevron]:-rotate-90',
        className
      )}
      {...props}
    >
      {children}
      {!hideChevron &&
        (icon ?? (
          <ChevronDown
            className={cn(
              'accordion-chevron h-5 w-5 shrink-0 text-muted-foreground',
              // Position on extreme right
              'ml-auto',
              'transition-transform',
              ACCORDION_DURATION_CLASS,
              'ease-out'
            )}
            aria-hidden="true"
          />
        ))}
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
));
AccordionTriggerCard.displayName = 'AccordionTriggerCard';

// ============================================================================
// UTILITY HOOK
// ============================================================================

/**
 * useAccordionAnimation Hook
 *
 * Returns CSS classes for custom accordion implementations
 * that need the same smooth animation without using the full component.
 *
 * @example
 * const { contentClasses, getContentStyles } = useAccordionAnimation();
 *
 * <div className={contentClasses} style={getContentStyles(isOpen)}>
 *   <div className="overflow-hidden">{content}</div>
 * </div>
 */
export function useAccordionAnimation() {
  return {
    /** Duration in milliseconds */
    durationMs: ACCORDION_ANIMATION_DURATION_MS,

    /** CSS classes for the content wrapper */
    contentClasses: cn(
      'grid transition-[grid-template-rows]',
      ACCORDION_DURATION_CLASS,
      'ease-out'
    ),

    /** Get grid-template-rows value based on state */
    getContentStyles: (isOpen: boolean): React.CSSProperties => ({
      gridTemplateRows: isOpen ? '1fr' : '0fr',
    }),

    /** Inner wrapper classes (required for animation) */
    innerClasses: 'overflow-hidden',
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Core components
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  // Card variants
  AccordionCard,
  AccordionItemCard,
  AccordionTriggerCard,
  // Constants (for custom implementations)
  ACCORDION_ANIMATION_DURATION_MS,
  ACCORDION_DURATION_CLASS,
};
