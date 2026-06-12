import { hasSupabaseCredentials, supabaseSelect, supabaseUpsert } from './supabase.js';

const SUPPORT_TICKETS_KEY = 'calcpro:support-tickets';
const GROUP_SUPPORT_TICKETS_KEY_PREFIX = 'calcpro:support-tickets:group:';

function normalizeGroupId(groupId) {
  const numericGroupId = Number(groupId);
  return Number.isInteger(numericGroupId) && numericGroupId > 0 ? String(numericGroupId) : '';
}

function getSupportTicketsKey(groupId) {
  const normalizedGroupId = normalizeGroupId(groupId);
  return normalizedGroupId
    ? `${GROUP_SUPPORT_TICKETS_KEY_PREFIX}${normalizedGroupId}`
    : SUPPORT_TICKETS_KEY;
}

function normalizeSupportTicket(ticket = {}) {
  return {
    id: String(ticket.id || `support-${Date.now()}`),
    type:
      ticket.type === 'bug' || ticket.type === 'suggestion' || ticket.type === 'message'
        ? ticket.type
        : 'message',
    status:
      ticket.status === 'reviewed' || ticket.status === 'rejected' || ticket.status === 'pending'
        ? ticket.status
        : 'pending',
    subject: String(ticket.subject || ''),
    message: String(ticket.message || ''),
    createdAt: String(ticket.createdAt || new Date().toISOString()),
    authorLabel: String(ticket.authorLabel || 'Неизвестный администратор'),
    authorVkId:
      Number.isInteger(Number(ticket.authorVkId)) && Number(ticket.authorVkId) > 0
        ? Number(ticket.authorVkId)
        : undefined,
  };
}

async function readSupportTicketRow(key) {
  if (!hasSupabaseCredentials()) {
    return null;
  }

  try {
    const rows = await supabaseSelect('app_settings', {
      select: 'value',
      filter: { key: 'key', value: `eq.${key}` },
      limit: 1,
    });

    return rows?.[0]?.value ?? null;
  } catch (error) {
    if (String(error?.message || '').includes('schema cache')) {
      return null;
    }

    throw error;
  }
}

async function writeSupportTicketRow(key, tickets) {
  if (!hasSupabaseCredentials()) {
    throw new Error('SUPABASE credentials are not configured');
  }

  try {
    await supabaseUpsert(
      'app_settings',
      [
        {
          key,
          value: tickets,
        },
      ],
      { onConflict: 'key' },
    );
  } catch (error) {
    if (!String(error?.message || '').includes('schema cache')) {
      throw error;
    }
  }
}

export async function getServerSupportTickets(groupId) {
  const key = getSupportTicketsKey(groupId);
  const value = await readSupportTicketRow(key);
  const tickets = Array.isArray(value) ? value : [];
  return tickets.map((ticket) => normalizeSupportTicket(ticket));
}

export async function addServerSupportTicket(ticket, groupId) {
  const current = await getServerSupportTickets(groupId);
  const next = [normalizeSupportTicket(ticket), ...current];
  await writeSupportTicketRow(getSupportTicketsKey(groupId), next);
  return next;
}

export async function updateServerSupportTicketStatus(ticketId, status, groupId) {
  const current = await getServerSupportTickets(groupId);
  const next = current.map((ticket) =>
    ticket.id === String(ticketId) ? normalizeSupportTicket({ ...ticket, status }) : ticket,
  );
  await writeSupportTicketRow(getSupportTicketsKey(groupId), next);
  return next;
}
