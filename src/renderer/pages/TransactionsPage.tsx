/**
 * Transactions Page
 *
 * Lists all transactions with filtering and pagination.
 *
 * @module renderer/pages/TransactionsPage
 */

import React, { useState } from 'react';
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
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-red-800 font-medium">Error loading transactions</h3>
        <p className="text-red-600 text-sm mt-1">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center space-x-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Start Date</label>
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
              className="border rounded px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">End Date</label>
            <input
              type="date"
              value={filters.endDate || ''}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, endDate: e.target.value || undefined, offset: 0 }))
              }
              className="border rounded px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Min Amount</label>
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
              className="border rounded px-3 py-1.5 text-sm w-24"
              placeholder="$0.00"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Max Amount</label>
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
              className="border rounded px-3 py-1.5 text-sm w-24"
              placeholder="$999.99"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Transactions List */}
        <div className="flex-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <LoadingSpinner />
            </div>
          ) : data && data.transactions.length > 0 ? (
            <>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Time
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Voided
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.transactions.map((tx) => (
                    <tr
                      key={tx.transaction_id}
                      onClick={() => setSelectedId(tx.transaction_id)}
                      className={`cursor-pointer hover:bg-gray-50 ${
                        selectedId === tx.transaction_id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {tx.transaction_number || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {formatDate(tx.business_date)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {tx.transaction_time ? formatTime(tx.transaction_time) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">
                        {formatCurrency(tx.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tx.voided ? (
                          <span className="text-red-600 text-xs font-medium">VOID</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                <div className="text-sm text-gray-500">
                  Showing {data.offset + 1} to{' '}
                  {Math.min(data.offset + data.transactions.length, data.total)} of {data.total}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={handlePrevPage}
                    disabled={!filters.offset || filters.offset === 0}
                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                  >
                    Previous
                  </button>
                  <button
                    onClick={handleNextPage}
                    disabled={!data.hasMore}
                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-gray-500">No transactions found</div>
          )}
        </div>

        {/* Transaction Detail Panel */}
        {selectedId && (
          <div className="w-96 bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Transaction Details</h3>
              <button
                onClick={() => setSelectedId(null)}
                className="text-gray-400 hover:text-gray-600"
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
                  <p className="text-sm text-gray-500">Transaction #</p>
                  <p className="font-medium">{selectedTransaction.transaction_number || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total</p>
                  <p className="text-xl font-bold text-green-600">
                    {formatCurrency(selectedTransaction.total_amount)}
                  </p>
                </div>

                {/* Line Items */}
                {selectedTransaction.lineItems && selectedTransaction.lineItems.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Line Items</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {selectedTransaction.lineItems.map((item) => (
                        <div
                          key={item.line_item_id}
                          className="flex justify-between text-sm border-b border-gray-100 pb-1"
                        >
                          <span className="text-gray-600 truncate flex-1">
                            {item.description || item.item_code || 'Item'}
                          </span>
                          <span className="text-gray-500 mx-2">x{item.quantity}</span>
                          <span className="font-medium">{formatCurrency(item.total_price)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Payments */}
                {selectedTransaction.payments && selectedTransaction.payments.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Payments</p>
                    <div className="space-y-2">
                      {selectedTransaction.payments.map((payment) => (
                        <div key={payment.payment_id} className="flex justify-between text-sm">
                          <span className="text-gray-600">{payment.payment_type}</span>
                          <span className="font-medium">{formatCurrency(payment.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500">Transaction not found</p>
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
