import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { DEFAULT_CATEGORIES } from '../lib/constants';

export const useSummary = (params) =>
  useQuery({ queryKey: ['summary', params], queryFn: () => api.summary(params), placeholderData: keepPreviousData });

export const useInsights = () => useQuery({ queryKey: ['insights'], queryFn: api.insights });

export const useTransactions = (params) =>
  useQuery({
    queryKey: ['transactions', params],
    queryFn: () => api.transactions.list(params),
    placeholderData: keepPreviousData,
  });

export const useSplits = (params) =>
  useQuery({ queryKey: ['splits', params], queryFn: () => api.splits.list(params), placeholderData: keepPreviousData });

export const usePeople = () => useQuery({ queryKey: ['people'], queryFn: api.splits.people });

export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: api.accounts.list });

export const useBudget = (month) =>
  useQuery({ queryKey: ['budget', month], queryFn: () => api.budgets.get(month), placeholderData: keepPreviousData });

export const useNotifications = () =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.notifications.list({ limit: 40 }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: api.settings.get, staleTime: Infinity });

export const useCategories = () =>
  useQuery({
    queryKey: ['categories'],
    queryFn: api.categories,
    select: (used) => ({
      debit: [...new Set([...DEFAULT_CATEGORIES.debit, ...used.debit])],
      credit: [...new Set([...DEFAULT_CATEGORIES.credit, ...used.credit])],
    }),
  });

/** Money changes ripple into balance, budget, insights and reminders, so refresh everything. */
function useAppMutation(mutationFn, successMessage) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries();
      const msg = typeof successMessage === 'function' ? successMessage(vars) : successMessage;
      if (msg) toast.success(msg);
    },
    onError: (err) => toast.error(err.message),
  });
}

export const useSaveTransaction = () =>
  useAppMutation(
    ({ id, data }) => (id ? api.transactions.update(id, data) : api.transactions.create(data)),
    ({ id }) => (id ? 'Transaction updated' : 'Transaction added'),
  );

export const useDeleteTransaction = () => useAppMutation((id) => api.transactions.remove(id), 'Transaction deleted');

export const useMarkPaid = () =>
  useAppMutation(
    ({ transactionId, participantId, body }) => api.splits.pay(transactionId, participantId, body),
    ({ name }) => `${name ?? 'Split'} paid you back. Added to your balance`,
  );

export const useMarkUnpaid = () =>
  useAppMutation(
    ({ transactionId, participantId }) => api.splits.unpay(transactionId, participantId),
    ({ name }) => `${name ?? 'Split'} marked as unpaid`,
  );

export const useSaveAccount = () =>
  useAppMutation(
    ({ id, data }) => (id ? api.accounts.update(id, data) : api.accounts.create(data)),
    ({ id, data, message }) => message ?? (id ? `${data.name ?? 'Account'} updated` : `${data.name} added`),
  );

export const useDeleteAccount = () => useAppMutation(({ id }) => api.accounts.remove(id), ({ name }) => `${name} deleted`);

export const useAssignUnassigned = () =>
  useAppMutation(
    ({ id }) => api.accounts.assignUnassigned(id),
    ({ name }) => `Older entries linked to ${name}`,
  );

export const useSaveBudget = () =>
  useAppMutation(({ month, data }) => api.budgets.save(month, data), 'Budget saved');

export const useResetBudget = () => useAppMutation((month) => api.budgets.reset(month), 'Budget reset');

export const useSaveSettings = () => useAppMutation((data) => api.settings.update(data), 'Settings saved');

function useNotificationMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err) => toast.error(err.message),
  });
}

export const useReadNotification = () => useNotificationMutation((id) => api.notifications.read(id));
export const useReadAllNotifications = () => useNotificationMutation(() => api.notifications.readAll());
export const useDeleteNotification = () => useNotificationMutation((id) => api.notifications.remove(id));
export const useClearReadNotifications = () => useNotificationMutation(() => api.notifications.clearRead());
