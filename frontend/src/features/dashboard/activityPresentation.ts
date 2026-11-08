import type { RecentActivity } from '../../services/dashboardService';

const actionDescriptions: Record<string, string> = {
  'Read Clients': 'Viewed client records',
  'Read Client': 'Viewed a client record',
  'Read Client Cases': 'Viewed cases for a client',
  'Read Cases': 'Viewed case records',
  'Read Terminated Cases': 'Viewed terminated case records',
  'Read Terminated Case': 'Viewed a terminated case record',
  'Read Document': 'Viewed a document',
  'Read Document Page': 'Viewed a document page',
  'Review Intake': 'Reviewed an intake record',
  'Re-extract Document': 'Re-ran document extraction',
  'Create Client': 'Created a client record',
  'Update Client': 'Updated a client record',
  'Create Case': 'Created a case record',
  'Update Case': 'Updated a case record',
  'Terminate Case': 'Terminated a case',
  'Login': 'Signed in',
  'Logout': 'Signed out',
  'Create Reminder': 'Created a reminder',
  'Updated Reminder': 'Updated a reminder',
  'Completed Reminder': 'Completed a reminder',
  'Deleted Reminder': 'Deleted a reminder',
  'Report Submitted': 'Submitted a staff report',
  'Correction Requested': 'Requested a report correction',
  'Version Approved': 'Approved a report version',
  'Version Resubmitted': 'Resubmitted a report version',
  'OCR Scan': 'Scanned a document',
};

export function presentActivity(item: RecentActivity) {
  const user = item.user?.trim();
  const description = actionDescriptions[item.action] ?? 'Recorded an account activity';
  if (['OCR Scan', 'Scan Document'].includes(item.action) && item.entity_id && /^\d+$/.test(item.entity_id)) {
    return `${user ? `${user} ` : ''}scanned document #${item.entity_id}`;
  }
  return user && !description.startsWith(`${user} `) ? `${user} ${description[0].toLowerCase()}${description.slice(1)}` : description;
}
