import * as React from 'react';

import { cn } from '../../lib/utils';

/**
 * Table Size Variants
 *
 * - default: Standard spacing (16px padding, 48px header height)
 * - compact: Reduced spacing for data-dense views (6px padding, 36px header)
 * - dense: Maximum density for dashboards (4px padding, 28px header)
 */
export type TableSize = 'default' | 'compact' | 'dense';

/**
 * Table Context
 *
 * Provides size variant to child components (TableHead, TableCell)
 * so they can automatically apply appropriate spacing without
 * requiring explicit className overrides on each element.
 */
interface TableContextValue {
  size: TableSize;
}

const TableContext = React.createContext<TableContextValue>({
  size: 'default',
});

/**
 * Hook to access table size context
 * @returns The current table size variant
 */
export function useTableContext(): TableContextValue {
  return React.useContext(TableContext);
}

/**
 * Size-specific class mappings
 * Maps semantic size names to Tailwind classes using design tokens
 */
const tableCellClasses: Record<TableSize, string> = {
  default: 'py-table-cell-y-default px-table-cell-x-default',
  compact: 'py-table-cell-y-compact px-table-cell-x-compact',
  dense: 'py-table-cell-y-dense px-table-cell-x-dense',
};

const tableHeadClasses: Record<TableSize, string> = {
  default: 'h-table-header-default px-table-cell-x-default py-table-cell-y-default',
  compact: 'h-table-header-compact px-table-cell-x-compact py-table-cell-y-compact',
  dense: 'h-table-header-dense px-table-cell-x-dense py-table-cell-y-dense',
};

/**
 * Table Props
 */
interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /**
   * Size variant for the table
   * Controls padding and height of all child cells and headers
   * @default "default"
   */
  size?: TableSize;
  /**
   * Whether this table is nested inside another table (e.g., accordion content)
   * When true, skips the outer wrapper div to avoid duplicate scroll containers
   * @default false
   */
  nested?: boolean;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, size = 'default', nested = false, children, ...props }, ref) => {
    const table = (
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props}>
        {children}
      </table>
    );

    return (
      <TableContext.Provider value={{ size }}>
        {nested ? table : <div className="relative w-full overflow-auto">{table}</div>}
      </TableContext.Provider>
    );
  }
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const { size } = useTableContext();

  return (
    <th
      ref={ref}
      className={cn(
        tableHeadClasses[size],
        'text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0',
        className
      )}
      {...props}
    />
  );
});
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const { size } = useTableContext();

  return (
    <td
      ref={ref}
      className={cn(
        tableCellClasses[size],
        'align-middle [&:has([role=checkbox])]:pr-0',
        className
      )}
      {...props}
    />
  );
});
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
