import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirmation } from '../../components/ConfirmationProvider';
import { useDashboardReminderStore, type ReminderPriority } from '../dashboardReminders/dashboardReminderStore';

function priority(date: string, completed = false): ReminderPriority {
  if (completed) return 'Low';
  const today = new Date(); today.setHours(0,0,0,0);
  const days = Math.ceil((new Date(`${date}T00:00:00`).getTime()-today.getTime())/86400000);
  return days <= 1 ? 'High' : days <= 7 ? 'Medium' : 'Low';
}
function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 'Date not recorded' : new Intl.DateTimeFormat('en-PH', {month:'short', day:'numeric',year:'numeric'}).format(date);
}
export function AdminReminders() {
  const { user } = useAuth(); const confirm = useConfirmation();
  const { reminders, loadReminders, addReminder, updateReminderStatus, deleteReminder } = useDashboardReminderStore();
  const [show, setShow] = useState(false); const [title, setTitle] = useState('');
  const [due, setDue] = useState(() => new Date().toLocaleDateString('en-CA'));
  useEffect(() => { if (user?.user_id) loadReminders(user.user_id); }, [user?.user_id, loadReminders]);
  const ordered = reminders.filter(r=>r.userId===user?.user_id).slice().sort((a,b) => Number(a.status==='Completed')-Number(b.status==='Completed') || a.dueDate.localeCompare(b.dueDate));
  return <section className="rounded-xl border border-[#DDE3EA] bg-white">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] px-5 py-4"><h2 className="text-lg font-semibold text-[#172534]">My reminders</h2><button className="dashboard-text-link" type="button" aria-expanded={show} onClick={()=>setShow(v=>!v)}>{show ? 'Close reminder form' : 'Add reminder'}</button></header>
    <div className="p-5"><p className="mb-4 text-xs text-[#526174]">Saved on this computer for your account.</p>
      {show && <form className="mb-5 space-y-3" onSubmit={e=>{e.preventDefault(); if (!user || !title.trim()) return; addReminder({userId:user.user_id,title:title.trim(),dueDate:due,priority:priority(due),status:'Open'});setTitle('');setShow(false);}}>
        <label className="block text-sm font-semibold" htmlFor="dashboard-reminder-title">Reminder title</label><input autoFocus id="dashboard-reminder-title" required maxLength={300} value={title} onChange={e=>setTitle(e.target.value)} className="min-h-11 w-full rounded-lg border border-[#CBD5E1] px-3" />
        <label className="block text-sm font-semibold" htmlFor="dashboard-reminder-date">Due date</label><input id="dashboard-reminder-date" type="date" required value={due} onChange={e=>setDue(e.target.value)} className="min-h-11 w-full rounded-lg border border-[#CBD5E1] px-3" />
        <p className="text-xs text-[#526174]">Priority follows the due date.</p><button type="submit" className="min-h-11 rounded-lg bg-[#704389] px-4 font-semibold text-white hover:bg-[#5F3675]">Save reminder</button>
      </form>}
      {ordered.length===0 ? <p className="text-sm leading-6 text-[#526174]">No reminders yet. Add a follow-up or deadline to keep it here.</p> : <ul className="divide-y divide-[#E5E7EB]">{ordered.map(r=><li key={r.id} className="py-4 first:pt-0"><p className={`break-words font-semibold ${r.status==='Completed' ? 'line-through text-[#526174]' : ''}`}>{r.title}</p><p className="mt-1 text-sm text-[#526174]">{dateLabel(r.dueDate)} · {r.status} · {priority(r.dueDate,r.status==='Completed')} priority</p><div className="mt-2 flex flex-wrap justify-between gap-2"><button type="button" className="dashboard-text-link" onClick={()=>updateReminderStatus(r.id,r.status==='Completed'?'Open':'Completed')}>{r.status==='Completed'?'Reopen reminder':'Mark complete'}</button><button type="button" aria-label={`Delete reminder: ${r.title}`} className="min-h-11 px-2 text-sm text-[#9F1239]" onClick={async()=>{if(await confirm({title:'Delete reminder?',message:'This reminder will be permanently removed.',confirmLabel:'Delete reminder'}))deleteReminder(r.id);}}>Delete</button></div></li>)}</ul>}
    </div>
  </section>;
}
