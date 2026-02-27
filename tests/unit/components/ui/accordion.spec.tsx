/**
 * Accordion Component Unit Tests
 *
 * Comprehensive test suite for the centralized accordion component.
 * Tests all exported components, variants, hooks, and constants.
 *
 * Traceability:
 * - SEC-004: XSS prevention via JSX auto-escaping (no dangerouslySetInnerHTML)
 * - SEC-014: Type-safe props with TypeScript interfaces
 * - FE-001: React JSX auto-escaping for all output
 * - ARCH-003: Semantic HTML, ARIA labels, keyboard navigation
 * - ARCH-004: Component-level isolation tests
 * - PERF-002: React.memo, forwardRef for composition
 * - A11Y-009: No keyboard traps, proper focus management
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/components/ui/accordion
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ============================================================================
// Import Components Under Test
// ============================================================================

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  AccordionCard,
  AccordionItemCard,
  AccordionTriggerCard,
  useAccordionAnimation,
  ACCORDION_ANIMATION_DURATION_MS,
  ACCORDION_DURATION_CLASS,
} from '../../../../src/renderer/components/ui/accordion';

// ============================================================================
// Test Helper Component for Hook Testing
// ============================================================================

function AnimationHookTester({ isOpen }: { isOpen: boolean }) {
  const { durationMs, contentClasses, getContentStyles, innerClasses } = useAccordionAnimation();

  return (
    <div data-testid="hook-tester">
      <span data-testid="duration-ms">{durationMs}</span>
      <div
        data-testid="content-wrapper"
        className={contentClasses}
        style={getContentStyles(isOpen)}
      >
        <div data-testid="inner-wrapper" className={innerClasses}>
          Content
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Constants Tests
// ============================================================================

describe('Accordion Constants', () => {
  it('should export ACCORDION_ANIMATION_DURATION_MS as 350', () => {
    expect(ACCORDION_ANIMATION_DURATION_MS).toBe(350);
  });

  it('should export ACCORDION_DURATION_CLASS as duration-[350ms]', () => {
    expect(ACCORDION_DURATION_CLASS).toBe('duration-[350ms]');
  });
});

// ============================================================================
// useAccordionAnimation Hook Tests
// ============================================================================

describe('useAccordionAnimation Hook', () => {
  it('should return durationMs of 350', () => {
    render(<AnimationHookTester isOpen={false} />);
    expect(screen.getByTestId('duration-ms').textContent).toBe('350');
  });

  it('should return contentClasses with grid and transition classes', () => {
    render(<AnimationHookTester isOpen={false} />);
    const wrapper = screen.getByTestId('content-wrapper');
    expect(wrapper.className).toContain('grid');
    expect(wrapper.className).toContain('transition-[grid-template-rows]');
    expect(wrapper.className).toContain('duration-[350ms]');
    expect(wrapper.className).toContain('ease-out');
  });

  it('should return gridTemplateRows: 0fr when closed', () => {
    render(<AnimationHookTester isOpen={false} />);
    const wrapper = screen.getByTestId('content-wrapper');
    expect(wrapper.style.gridTemplateRows).toBe('0fr');
  });

  it('should return gridTemplateRows: 1fr when open', () => {
    render(<AnimationHookTester isOpen={true} />);
    const wrapper = screen.getByTestId('content-wrapper');
    expect(wrapper.style.gridTemplateRows).toBe('1fr');
  });

  it('should return innerClasses with overflow-hidden', () => {
    render(<AnimationHookTester isOpen={false} />);
    const inner = screen.getByTestId('inner-wrapper');
    expect(inner.className).toContain('overflow-hidden');
  });
});

// ============================================================================
// Accordion Root Tests
// ============================================================================

describe('Accordion Root', () => {
  it('should render children', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Test Trigger</AccordionTrigger>
          <AccordionContent>Test Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    expect(screen.getByText('Test Trigger')).toBeInTheDocument();
  });

  it('should support single type with collapsible', () => {
    render(
      <Accordion type="single" collapsible defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger>Section 1</AccordionTrigger>
          <AccordionContent>Content 1</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    // Content should be visible when defaultValue matches
    expect(screen.getByText('Content 1')).toBeInTheDocument();
  });

  it('should support multiple type', () => {
    render(
      <Accordion type="multiple" defaultValue={['item-1', 'item-2']}>
        <AccordionItem value="item-1">
          <AccordionTrigger>Section 1</AccordionTrigger>
          <AccordionContent>Content 1</AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-2">
          <AccordionTrigger>Section 2</AccordionTrigger>
          <AccordionContent>Content 2</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    // Both contents should be visible
    expect(screen.getByText('Content 1')).toBeInTheDocument();
    expect(screen.getByText('Content 2')).toBeInTheDocument();
  });
});

// ============================================================================
// AccordionItem Tests
// ============================================================================

describe('AccordionItem', () => {
  it('should render with border-b class', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1" data-testid="accordion-item">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const item = screen.getByTestId('accordion-item');
    expect(item.className).toContain('border-b');
    expect(item.className).toContain('border-border');
  });

  it('should apply last:border-b-0 class', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1" data-testid="accordion-item">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const item = screen.getByTestId('accordion-item');
    expect(item.className).toContain('last:border-b-0');
  });

  it('should accept custom className', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1" className="custom-class" data-testid="accordion-item">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const item = screen.getByTestId('accordion-item');
    expect(item.className).toContain('custom-class');
  });

  it('should have displayName', () => {
    expect(AccordionItem.displayName).toBe('AccordionItem');
  });
});

// ============================================================================
// AccordionTrigger Tests
// ============================================================================

describe('AccordionTrigger', () => {
  it('should render children', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Click Me</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    expect(screen.getByText('Click Me')).toBeInTheDocument();
  });

  it('should render as a button', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should render chevron by default', () => {
    const { container } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const chevron = container.querySelector('.accordion-chevron');
    expect(chevron).toBeInTheDocument();
  });

  it('should hide chevron when hideChevron=true', () => {
    const { container } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger hideChevron>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const chevron = container.querySelector('.accordion-chevron');
    expect(chevron).not.toBeInTheDocument();
  });

  it('should render custom icon when provided', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger icon={<span data-testid="custom-icon">X</span>}>
            Trigger
          </AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('should have aria-hidden on chevron', () => {
    const { container } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const chevron = container.querySelector('.accordion-chevron');
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
  });

  it('should have animation duration class on chevron', () => {
    const { container } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const chevron = container.querySelector('.accordion-chevron');
    expect(chevron!.getAttribute('class')).toContain('duration-[350ms]');
  });

  it('should have ease-out transition on chevron', () => {
    const { container } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const chevron = container.querySelector('.accordion-chevron');
    expect(chevron!.getAttribute('class')).toContain('ease-out');
  });

  it('should position chevron with ml-auto', () => {
    const { container } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const chevron = container.querySelector('.accordion-chevron');
    expect(chevron!.getAttribute('class')).toContain('ml-auto');
  });

  it('should have displayName', () => {
    expect(AccordionTrigger.displayName).toBe('AccordionTrigger');
  });
});

// ============================================================================
// AccordionContent Tests
// ============================================================================

describe('AccordionContent', () => {
  it('should render children when expanded', () => {
    render(
      <Accordion type="single" collapsible defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>
            <span data-testid="content-child">Child Content</span>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    expect(screen.getByTestId('content-child')).toBeInTheDocument();
  });

  it('should have CSS Grid animation classes', () => {
    render(
      <Accordion type="single" collapsible defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent data-testid="accordion-content">Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const content = screen.getByTestId('accordion-content');
    expect(content.className).toContain('grid');
    expect(content.className).toContain('transition-[grid-template-rows]');
  });

  it('should have animation duration class', () => {
    render(
      <Accordion type="single" collapsible defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent data-testid="accordion-content">Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const content = screen.getByTestId('accordion-content');
    expect(content.className).toContain('duration-[350ms]');
  });

  it('should have ease-out timing function', () => {
    render(
      <Accordion type="single" collapsible defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent data-testid="accordion-content">Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const content = screen.getByTestId('accordion-content');
    expect(content.className).toContain('ease-out');
  });

  it('should have data-state=open when expanded', () => {
    render(
      <Accordion type="single" collapsible defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent data-testid="accordion-content">Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const content = screen.getByTestId('accordion-content');
    expect(content).toHaveAttribute('data-state', 'open');
  });

  it('should have data-state=closed when collapsed', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent data-testid="accordion-content">Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const content = screen.getByTestId('accordion-content');
    expect(content).toHaveAttribute('data-state', 'closed');
  });

  it('should have overflow-hidden inner wrapper', () => {
    render(
      <Accordion type="single" collapsible defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent data-testid="accordion-content">Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const content = screen.getByTestId('accordion-content');
    const innerWrapper = content.firstElementChild;
    expect(innerWrapper!.className).toContain('overflow-hidden');
  });

  it('should have displayName', () => {
    expect(AccordionContent.displayName).toBe('AccordionContent');
  });
});

// ============================================================================
// Interaction Tests
// ============================================================================

describe('Accordion Interactions', () => {
  it('should toggle content on click', async () => {
    const user = userEvent.setup();
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Toggle Me</AccordionTrigger>
          <AccordionContent data-testid="content">Hidden Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );

    const content = screen.getByTestId('content');
    expect(content).toHaveAttribute('data-state', 'closed');

    await user.click(screen.getByRole('button'));
    expect(content).toHaveAttribute('data-state', 'open');

    await user.click(screen.getByRole('button'));
    expect(content).toHaveAttribute('data-state', 'closed');
  });

  it('should toggle on Enter key', async () => {
    const user = userEvent.setup();
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Toggle Me</AccordionTrigger>
          <AccordionContent data-testid="content">Hidden Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );

    const button = screen.getByRole('button');
    const content = screen.getByTestId('content');

    button.focus();
    await user.keyboard('{Enter}');
    expect(content).toHaveAttribute('data-state', 'open');
  });

  it('should toggle on Space key', async () => {
    const user = userEvent.setup();
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Toggle Me</AccordionTrigger>
          <AccordionContent data-testid="content">Hidden Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );

    const button = screen.getByRole('button');
    const content = screen.getByTestId('content');

    button.focus();
    await user.keyboard(' ');
    expect(content).toHaveAttribute('data-state', 'open');
  });

  it('should only allow one open in single mode', async () => {
    const user = userEvent.setup();
    render(
      <Accordion type="single" defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger>Section 1</AccordionTrigger>
          <AccordionContent data-testid="content-1">Content 1</AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-2">
          <AccordionTrigger>Section 2</AccordionTrigger>
          <AccordionContent data-testid="content-2">Content 2</AccordionContent>
        </AccordionItem>
      </Accordion>
    );

    expect(screen.getByTestId('content-1')).toHaveAttribute('data-state', 'open');
    expect(screen.getByTestId('content-2')).toHaveAttribute('data-state', 'closed');

    // Click second trigger
    await user.click(screen.getByText('Section 2'));

    expect(screen.getByTestId('content-1')).toHaveAttribute('data-state', 'closed');
    expect(screen.getByTestId('content-2')).toHaveAttribute('data-state', 'open');
  });

  it('should allow multiple open in multiple mode', async () => {
    const user = userEvent.setup();
    render(
      <Accordion type="multiple">
        <AccordionItem value="item-1">
          <AccordionTrigger>Section 1</AccordionTrigger>
          <AccordionContent data-testid="content-1">Content 1</AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-2">
          <AccordionTrigger>Section 2</AccordionTrigger>
          <AccordionContent data-testid="content-2">Content 2</AccordionContent>
        </AccordionItem>
      </Accordion>
    );

    // Open both
    await user.click(screen.getByText('Section 1'));
    await user.click(screen.getByText('Section 2'));

    expect(screen.getByTestId('content-1')).toHaveAttribute('data-state', 'open');
    expect(screen.getByTestId('content-2')).toHaveAttribute('data-state', 'open');
  });
});

// ============================================================================
// Accessibility Tests (ARCH-003, A11Y-009)
// ============================================================================

describe('Accordion Accessibility', () => {
  it('should have aria-expanded on trigger', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('should update aria-expanded when opened', async () => {
    const user = userEvent.setup();
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const button = screen.getByRole('button');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('should have aria-controls linking trigger to content', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const button = screen.getByRole('button');
    const ariaControls = button.getAttribute('aria-controls');
    expect(ariaControls).toBeTruthy();
    // Verify the controlled element exists
    expect(document.getElementById(ariaControls!)).toBeInTheDocument();
  });

  it('should wrap trigger in heading element', () => {
    const { container } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const heading = container.querySelector('h3');
    expect(heading).toBeInTheDocument();
  });

  it('should support focus visible styling', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const button = screen.getByRole('button');
    expect(button.className).toContain('focus-visible:outline-none');
    expect(button.className).toContain('focus-visible:ring-2');
  });
});

// ============================================================================
// Card Variants Tests
// ============================================================================

describe('AccordionCard', () => {
  it('should render with rounded-xl class', () => {
    render(
      <AccordionCard type="single" collapsible data-testid="accordion-card">
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </AccordionCard>
    );
    const card = screen.getByTestId('accordion-card');
    expect(card.className).toContain('rounded-xl');
    expect(card.className).toContain('bg-card');
    expect(card.className).toContain('shadow-card');
  });

  it('should have displayName', () => {
    expect(AccordionCard.displayName).toBe('AccordionCard');
  });
});

describe('AccordionItemCard', () => {
  it('should render with overflow-hidden', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItemCard value="item-1" data-testid="item-card">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItemCard>
      </Accordion>
    );
    const item = screen.getByTestId('item-card');
    expect(item.className).toContain('overflow-hidden');
  });

  it('should have displayName', () => {
    expect(AccordionItemCard.displayName).toBe('AccordionItemCard');
  });
});

describe('AccordionTriggerCard', () => {
  it('should render with gradient background', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTriggerCard>Trigger</AccordionTriggerCard>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const button = screen.getByRole('button');
    expect(button.className).toContain('bg-gradient-to-r');
  });

  it('should have min-height matching DayAccordion', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTriggerCard>Trigger</AccordionTriggerCard>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const button = screen.getByRole('button');
    expect(button.className).toContain('min-h-[88px]');
  });

  it('should have larger chevron (h-5 w-5)', () => {
    const { container } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTriggerCard>Trigger</AccordionTriggerCard>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const chevron = container.querySelector('.accordion-chevron');
    expect(chevron!.getAttribute('class')).toContain('h-5');
    expect(chevron!.getAttribute('class')).toContain('w-5');
  });

  it('should have animation duration on chevron', () => {
    const { container } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTriggerCard>Trigger</AccordionTriggerCard>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const chevron = container.querySelector('.accordion-chevron');
    expect(chevron!.getAttribute('class')).toContain('duration-[350ms]');
  });

  it('should have displayName', () => {
    expect(AccordionTriggerCard.displayName).toBe('AccordionTriggerCard');
  });
});

// ============================================================================
// XSS Prevention Tests (SEC-004, FE-001)
// ============================================================================

describe('XSS Prevention', () => {
  it('should safely render script tags in trigger text via JSX escaping', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>{'<script>alert("xss")</script>'}</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('<script>');
    expect(button.querySelector('script')).toBeNull();
  });

  it('should safely render HTML in content via JSX escaping', () => {
    render(
      <Accordion type="single" collapsible defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>{'<img src=x onerror=alert(1)>'}</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    const content = screen.getByText('<img src=x onerror=alert(1)>');
    expect(content).toBeInTheDocument();
    // No actual img element should be created
    expect(content.querySelector('img')).toBeNull();
  });
});

// ============================================================================
// Ref Forwarding Tests (PERF-002)
// ============================================================================

describe('Ref Forwarding', () => {
  it('should forward ref to AccordionItem', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1" ref={ref}>
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('should forward ref to AccordionTrigger', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger ref={ref}>Trigger</AccordionTrigger>
          <AccordionContent>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('should forward ref to AccordionContent', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <Accordion type="single" collapsible defaultValue="item-1">
        <AccordionItem value="item-1">
          <AccordionTrigger>Trigger</AccordionTrigger>
          <AccordionContent ref={ref}>Content</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
