import { engineStatus, gapStatus, lineEndStatus, type CheckResults, type ItemStatus } from '../lib/checkResults';
import type { Repertoire } from '../lib/repertoire';
import { useApp, type CheckTour } from '../lib/store';
import { formatPct } from './ExplorerPanel';
import { Icon } from './Icon';

/** "1… Nc6" / "3. Ba6": a move with its number, played after `line`. */
const numbered = (line: string[], san: string) => `${Math.floor(line.length / 2) + 1}${line.length % 2 ? '…' : '.'} ${san}`;

export interface TourItem {
  id: string;
  /** Moves to the position to open. */
  line: string[];
  label: React.ReactNode;
  status: ItemStatus;
  /** Share of your games (gaps and line ends). */
  reach?: number;
}

/** The items of one result list, in the order shown on the Check page. */
export function tourItems(rep: Repertoire, saved: CheckResults | undefined, kind: CheckTour['kind']): TourItem[] {
  if (kind === 'gaps')
    return (saved?.gaps?.report.gaps ?? []).map((g) => ({
      id: `${g.key}|${g.san}`,
      line: g.line,
      reach: g.reach,
      label: (
        <>
          {numbered(g.line, g.san)} <span className="muted">· {formatPct(g.reach)} of your games</span>
        </>
      ),
      status: gapStatus(rep, g),
    }));
  if (kind === 'ends')
    return (saved?.gaps?.report.lineEnds ?? []).map((e) => ({
      id: e.key,
      line: e.line,
      reach: e.reach,
      label: (
        <>
          ends after {e.line.length ? numbered(e.line.slice(0, -1), e.line[e.line.length - 1]) : 'the start'} <span className="muted">· {formatPct(e.reach)}</span>
        </>
      ),
      status: lineEndStatus(rep, e),
    }));
  return (saved?.engine?.issues ?? []).map((it) => ({
    id: it.id,
    line: it.line,
    label: (
      <>
        {numbered(it.line, it.san)} <span className="muted">· better {it.flag.bestSan}</span>
      </>
    ),
    status: engineStatus(rep, it, saved?.engine?.threshold ?? 50),
  }));
}

export function StatusMark({ status }: { status: ItemStatus }) {
  if (status.state === 'open') return null;
  return (
    <span className={`status-mark ${status.state}`} title={status.note}>
      {status.state === 'done' ? <Icon name="check" size={14} /> : '◐'}
    </span>
  );
}

const KIND_NAMES: Record<CheckTour['kind'], string> = { gaps: 'Missing reply', ends: 'Line that ends early', engine: 'Dubious move' };

/** On the Build board while going through a check's results: where you are, what is done, and on to the next. */
export function CheckTourBar({ rep }: { rep: Repertoire }) {
  const tour = useApp((s) => s.checkTour);
  const saved = useApp((s) => s.data.checks?.[rep.id]);
  const { tourTo, goToSans, setView } = useApp.getState();
  if (!tour || tour.repId !== rep.id) return null;
  const items = tourItems(rep, saved, tour.kind);
  const byId = new Map(items.map((it) => [it.id, it]));
  const list = tour.ids.map((id) => byId.get(id)).filter((x): x is TourItem => !!x);
  const index = Math.min(tour.index, list.length - 1);
  const item = list[index];
  if (!item) return null;
  const done = list.filter((x) => x.status.state === 'done').length;
  const go = (i: number) => {
    const next = list[i];
    if (!next) return;
    tourTo({ ...tour, index: i });
    goToSans(next.line);
  };
  const nextOpen = list.findIndex((x, i) => i > index && x.status.state !== 'done');

  return (
    <div className="card tour-bar">
      <div className="row wrap" style={{ gap: 6 }}>
        <b className="small">
          {KIND_NAMES[tour.kind]} {index + 1} of {list.length}
        </b>
        <span className="small muted">
          · {done} done
        </span>
        <span className="spacer" />
        <button className="btn sm icon ghost" title="Stop going through the list" onClick={() => tourTo(null)}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="row wrap tour-item">
        <StatusMark status={item.status} />
        <span className="small">{item.label}</span>
        {item.status.note && <span className="small faint">({item.status.note})</span>}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn sm" disabled={index === 0} onClick={() => go(index - 1)}>
          <Icon name="prev" size={14} /> Previous
        </button>
        <button className="btn sm primary" disabled={index >= list.length - 1} onClick={() => go(index + 1)}>
          Next <Icon name="next" size={14} />
        </button>
        {nextOpen > index + 1 && (
          <button className="btn sm ghost" onClick={() => go(nextOpen)} title="Skip the ones you have done">
            Next to do
          </button>
        )}
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => setView('audit')}>
          <Icon name="audit" size={14} /> All results
        </button>
      </div>
    </div>
  );
}
