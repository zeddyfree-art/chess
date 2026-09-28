import { useState } from 'react';
import { exportPgn, importPgn } from '../lib/pgn';
import { getLichessUser, getToken, logout, RATING_BUCKETS, ratingLabel, setToken, SPEED_LABELS, SPEEDS, startLogin, verifyToken } from '../lib/lichess';
import { stats } from '../lib/repertoire';
import { activeRep, exportBackup, parseBackup, PROFILE_COLORS, useApp, type Profile } from '../lib/store';
import { ChoiceDialog, type Choice } from './Dialog';
import { Icon } from './Icon';

function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.replace(/[^\w\-. ]+/g, '_').trim() || 'repertoire';

export function SettingsView() {
  const data = useApp((s) => s.data);
  const rep = useApp(activeRep);
  const { addProfile, updateProfile, deleteProfile, updateRep, renameRepertoire, deleteRepertoire, replaceData, markBackup, showToast } =
    useApp.getState();
  const [dialog, setDialog] = useState<{ title: string; body: React.ReactNode; choices: Choice[] } | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenMsg, setTokenMsg] = useState<string | null>(null);
  const [user, setUser] = useState(getLichessUser());
  const [hasToken, setHasToken] = useState(!!getToken());

  const saveToken = async () => {
    setTokenMsg('Controleren…');
    try {
      const name = await verifyToken(tokenInput.trim());
      setToken(tokenInput.trim(), name);
      setUser(name);
      setHasToken(true);
      setTokenInput('');
      setTokenMsg(null);
      showToast(`Gekoppeld als ${name}`);
    } catch (e) {
      setTokenMsg((e as Error).message);
    }
  };

  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    try {
      const incoming = parseBackup(await file.text());
      const moves = incoming.repertoires.reduce((a, r) => a + stats(r).moves, 0);
      setDialog({
        title: 'Back-up terugzetten?',
        body: (
          <>
            Het bestand bevat {incoming.profiles.length} profiel(en) en {incoming.repertoires.length} repertoire(s) met{' '}
            {moves} zetten. <b>Alles wat nu in de app staat wordt vervangen.</b>
          </>
        ),
        choices: [{ label: 'Vervangen', kind: 'danger', run: () => (replaceData(incoming), showToast('Back-up teruggezet')) }],
      });
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const mergePgn = async (file: File | undefined) => {
    if (!file || !rep) return;
    const res = importPgn(rep, await file.text());
    updateRep(rep.id, () => res.rep, 'PGN-import');
    showToast(`${res.added} nieuwe zetten toegevoegd${res.errors.length ? ` (${res.errors.length} waarschuwingen)` : ''}`);
  };

  return (
    <div className="stack" style={{ maxWidth: 860, margin: '0 auto', gap: 16 }}>
      <div className="card">
        <div className="section row">
          <h2>Profielen</h2>
          <span className="spacer" />
          <button
            className="btn"
            onClick={() =>
              addProfile({
                name: 'Nieuw profiel',
                color: PROFILE_COLORS[data.profiles.length % PROFILE_COLORS.length],
                ratings: [1200, 1400, 1600],
                speeds: ['blitz', 'rapid', 'classical'],
              })
            }
          >
            <Icon name="plus" size={16} /> Profiel
          </button>
        </div>
        {data.profiles.map((p) => (
          <ProfileEditor
            key={p.id}
            profile={p}
            repCount={data.repertoires.filter((r) => r.profileId === p.id).length}
            canDelete={data.profiles.length > 1}
            onChange={(patch) => updateProfile(p.id, patch)}
            onDelete={() =>
              setDialog({
                title: `Profiel ${p.name} verwijderen?`,
                body: 'Alle repertoires van dit profiel worden ook verwijderd. Maak eventueel eerst een back-up.',
                choices: [{ label: 'Verwijderen', kind: 'danger', run: () => deleteProfile(p.id) }],
              })
            }
          />
        ))}
      </div>

      <div className="card">
        <div className="section">
          <h2>Lichess-koppeling</h2>
        </div>
        <div className="section stack" style={{ gap: 10 }}>
          <div className="help">
            De Opening Explorer (wat er gespeeld wordt per ratinggroep) vereist sinds 2026 een Lichess-account. Inloggen gaat via
            Lichess zelf (OAuth); deze app ziet je wachtwoord nooit en vraagt geen extra rechten. De koppeling wordt alleen in
            deze browser bewaard.
          </div>
          {hasToken ? (
            <div className="row">
              <span className="badge mine">
                <Icon name="check" size={12} /> gekoppeld{user ? ` als ${user}` : ''}
              </span>
              <span className="spacer" />
              <button
                className="btn"
                onClick={async () => {
                  await logout();
                  setHasToken(false);
                  setUser(null);
                }}
              >
                Ontkoppelen
              </button>
            </div>
          ) : (
            <>
              <div className="row">
                <button className="btn primary" onClick={() => startLogin()}>
                  Inloggen met Lichess
                </button>
              </div>
              <div className="field">
                <label>Of: plak een persoonlijk API-token</label>
                <div className="row">
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    type="password"
                    placeholder="lip_…"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                  />
                  <button className="btn" disabled={!tokenInput.trim()} onClick={saveToken}>
                    Opslaan
                  </button>
                </div>
                <div className="help">
                  Maak er een op{' '}
                  <a href="https://lichess.org/account/oauth/token/create?description=Repertoire%20trainer" target="_blank" rel="noreferrer">
                    lichess.org/account/oauth/token
                  </a>{' '}
                  — vink géén rechten aan, die zijn niet nodig.
                </div>
                {tokenMsg && <div className="small muted">{tokenMsg}</div>}
              </div>
            </>
          )}
        </div>
      </div>

      {rep && (
        <div className="card">
          <div className="section">
            <h2>Repertoire: {rep.name}</h2>
          </div>
          <div className="section stack" style={{ gap: 10 }}>
            <div className="field">
              <label>Naam</label>
              <input className="input" defaultValue={rep.name} onBlur={(e) => e.target.value.trim() && renameRepertoire(rep.id, e.target.value.trim())} />
            </div>
            <div className="row wrap">
              <button className="btn" onClick={() => download(`${safeName(rep.name)}.pgn`, exportPgn(rep), 'application/x-chess-pgn')}>
                <Icon name="download" size={16} /> Exporteer PGN
              </button>
              <label className="btn">
                <Icon name="upload" size={16} /> PGN toevoegen…
                <input type="file" accept=".pgn,text/plain" hidden onChange={(e) => mergePgn(e.target.files?.[0])} />
              </label>
              <span className="spacer" />
              <button
                className="btn danger"
                onClick={() =>
                  setDialog({
                    title: `${rep.name} verwijderen?`,
                    body: `Het hele repertoire (${stats(rep).moves} zetten) en de trainingsgeschiedenis worden verwijderd.`,
                    choices: [{ label: 'Verwijderen', kind: 'danger', run: () => deleteRepertoire(rep.id) }],
                  })
                }
              >
                <Icon name="trash" size={16} /> Verwijderen
              </button>
            </div>
            <div className="help">
              De PGN-export bevat alle lijnen als varianten en kan in Lichess-studies, ChessBase of Chessbook worden geladen.
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="section">
          <h2>Gegevens &amp; back-up</h2>
        </div>
        <div className="section stack" style={{ gap: 10 }}>
          <div className="help">
            Alles staat lokaal in deze browser (IndexedDB) — geen account, geen server, geen limiet. Maak af en toe een back-up,
            bijvoorbeeld naar je cloudmap, en gebruik die ook om je repertoire naar een ander apparaat over te zetten.
          </div>
          <div className="row wrap">
            <button
              className="btn primary"
              onClick={() => {
                download(`repertoire-backup-${new Date().toISOString().slice(0, 10)}.json`, exportBackup(data), 'application/json');
                markBackup();
              }}
            >
              <Icon name="download" size={16} /> Back-up downloaden
            </button>
            <label className="btn">
              <Icon name="upload" size={16} /> Back-up terugzetten…
              <input type="file" accept=".json,application/json" hidden onChange={(e) => importBackup(e.target.files?.[0])} />
            </label>
            <span className="small muted">
              {data.lastBackupAt ? `Laatste back-up: ${new Date(data.lastBackupAt).toLocaleDateString('nl-NL')}` : 'Nog geen back-up gemaakt'}
            </span>
          </div>
        </div>
      </div>

      {dialog && <ChoiceDialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ProfileEditor({
  profile,
  repCount,
  canDelete,
  onChange,
  onDelete,
}: {
  profile: Profile;
  repCount: number;
  canDelete: boolean;
  onChange: (patch: Partial<Profile>) => void;
  onDelete: () => void;
}) {
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="section stack" style={{ gap: 10 }}>
      <div className="row">
        <div className="avatar" style={{ background: profile.color, width: 28, height: 28, fontSize: 13 }}>
          {profile.name.slice(0, 1).toUpperCase()}
        </div>
        <input className="input" defaultValue={profile.name} onBlur={(e) => e.target.value.trim() && onChange({ name: e.target.value.trim() })} />
        <div className="row" style={{ gap: 4 }}>
          {PROFILE_COLORS.map((c) => (
            <span
              key={c}
              onClick={() => onChange({ color: c })}
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: c,
                cursor: 'pointer',
                outline: c === profile.color ? '2px solid var(--text)' : 'none',
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
        <span className="spacer" />
        <span className="small muted">{repCount} repertoire(s)</span>
        {canDelete && (
          <button className="btn sm icon ghost danger" onClick={onDelete} title="Profiel verwijderen">
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
      <div className="field">
        <label className="small">Ratinggroepen in de database (gemiddelde rating van de spelers)</label>
        <div className="filter-row">
          {RATING_BUCKETS.map((r) => (
            <span key={r} className={`chip ${profile.ratings.includes(r) ? 'on' : ''}`} onClick={() => onChange({ ratings: toggle(profile.ratings, r).sort((a, b) => a - b) })}>
              {ratingLabel(r)}
            </span>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="small">Speeltempo’s</label>
        <div className="filter-row">
          {SPEEDS.map((s) => (
            <span key={s} className={`chip ${profile.speeds.includes(s) ? 'on' : ''}`} onClick={() => onChange({ speeds: toggle(profile.speeds, s) })}>
              {SPEED_LABELS[s]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
