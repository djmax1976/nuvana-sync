/**
 * Transactions Page
 *
 * Lists all transactions with filtering and pagination.
 *
 * @module renderer/pages/TransactionsPage
 */

import { useState } from 'react';
import { useTransactions, useTransaction } from '../lib/hooks';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import type { TransactionListParams } from '../lib/transport';

export default function TransactionsPage() {
  const [filters, setFilters] = useState<TransactionListParams>({
    limit: 50,
    offset: 0,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, error } = useTransactions(filters);
  const { data: selectedTransaction, isLoading: detailLoading } = useTransaction(selectedId);

  const handleNextPage = () => {
    if (data && data.hasMore) {
      setFilters((prev) => ({ ...prev, offset: (prev.offset || 0) + (prev.limit || 50) }));
    }
  };

  const handlePrevPage = () => {
    if (filters.offset && filters.offset > 0) {
      setFilters((prev) => ({
        ...prev,
        offset: Math.max(0, (prev.offset || 0) - (prev.limit || 50)),
      }));
    }
  };

  if (error) {
    return (
      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
        <h3 className="text-destructive font-medium">Error loading transactions</h3>
        <p className="text-destructive/80 text-sm mt-1">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center space-x-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Start Date</label>
            <input
              type="date"
              value={filters.startDate || ''}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  startDate: e.target.value || undefined,
                  offset: 0,
                }))
              }
              className="border border-border rounded px-3 py-1.5 text-sm bg-background text-foreground"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">End Date</label>
            <input
              type="date"
              value={filters.endDate || ''}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, endDate: e.target.value || undefined, offset: 0 }))
              }
              className="border border-border rounded px-3 py-1.5 text-sm bg-background text-foreground"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Min Amount</label>
            <input
              type="number"
              value={filters.minAmount || ''}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  minAmount: e.target.value ? parseFloat(e.target.value) : undefined,
                  offset: 0,
                }))
              }
              className="border border-border rounded px-3 py-1.5 text-sm w-24 bg-background text-foreground"
              placeholder="$0.00"
            />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Max Amount</label>
            <input
              type="number"
              value={filters.maxAmount || ''}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  maxAmount: e.target.value ? parseFloat(e.target.value) : undefined,
                  offset: 0,
                }))
              }
              className="border border-border rounded px-3 py-1.5 text-sm w-24 bg-background text-foreground"
              placeholder="$999.99"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Transactions List */}
        <div className="flex-1 bg-card rounded-lg border border-border overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <LoadingSpinner />
            </div>
          ) : data && data.transactions.length > 0 ? (
            <>
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                      Time
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase">
                      Voided
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.transactions.map((tx) => (
                    <tr
                      key={tx.transaction_id}
                      onClick={() => setSelectedId(tx.transaction_id)}
                      className={`cursor-pointer hover:bg-muted/50 ${
                        selectedId === tx.transaction_id ? 'bg-primary/10' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-sm text-foreground">
                        {tx.transaction_number || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {formatDate(tx.business_date)}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {tx.transaction_time ? formatTime(tx.transaction_time) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground text-right font-medium">
                        {formatCurrency(tx.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tx.voided ? (
                          <span className="text-destructive text-xs font-medium">VOID</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="px-4 py-3 bg-muted/50 border-t border-border flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing {data.offset + 1} to{' '}
                  {Math.min(data.offset + data.transactions.length, data.total)} of {data.total}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={handlePrevPage}
                    disabled={!filters.offset || filters.offset === 0}
                    className="px-3 py-1 text-sm border border-border rounded text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
                  >
                    Previous
                  </button>
                  <button
                    onClick={handleNextPage}
                    disabled={!data.hasMore}
                    className="px-3 py-1 text-sm border border-border rounded text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-muted-foreground">No transactions found</div>
          )}
        </div>

        {/* Transaction Detail Panel */}
        {selectedId && (
          <div className="w-96 bg-card rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Transaction Details</h3>
              <button
                onClick={() => setSelectedId(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center h-32">
                <LoadingSpinner />
              </div>
            ) : selectedTransaction ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Transaction #</p>
                  <p className="font-medium text-foreground">
                    {selectedTransaction.transaction_number || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-xl font-bold text-green-600 dark:text-green-400">
                    {formatCurrency(selectedTransaction.total_amount)}
                  </p>
                </div>

                {/* Line Items */}
                {selectedTransaction.lineItems && selectedTransaction.lineItems.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-foreground mb-2">Line Items</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {selectedTransaction.lineItems.map((item) => (
                        <div
                          key={item.line_item_id}
                          className="flex justify-between text-sm border-b border-border pb-1"
                        >
                          <span className="text-muted-foreground truncate flex-1">
                            {item.description || item.item_code || 'Item'}
                          </span>
                          <span className="text-muted-foreground mx-2">x{item.quantity}</span>
                          <span className="font-medium text-foreground">
                            {formatCurrency(item.total_price)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Payments */}
                {selectedTransaction.payments && selectedTransaction.payments.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-foreground mb-2">Payments</p>
                    <div className="space-y-2">
                      {selectedTransaction.payments.map((payment) => (
                        <div key={payment.payment_id} className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{payment.payment_type}</span>
                          <span className="font-medium text-foreground">
                            {formatCurrency(payment.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">Transaction not found</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Formatters
// ============================================================================

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(timeStr: string): string {
  return new Date(timeStr).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}
