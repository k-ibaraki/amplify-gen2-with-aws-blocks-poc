import { useEffect, useState } from 'react';
// バックエンドは AWS Blocks。認証は Amplify ネイティブ Cognito を Blocks が消費（fromExisting）。
// frontend は `aws-blocks` クライアント1本のまま（aws-amplify は使わない＝純 Blocks 維持）。
import { api, authApi } from 'aws-blocks';
import { Authenticator, onAuthChange } from '@aws-blocks/blocks/ui';

type Todo = { pk: string; id: string; content: string; createdAt: number };
// username は Cognito では UUID、mock では email になる。表示は email 属性で統一する。
type User = { username: string; userId: string; attributes?: { email?: string } };

// サインイン用 Authenticator をモーダルで開く（本家 AccountMenuBar と同じ挙動）。
function openSignInModal() {
  const modal = document.createElement('div');
  modal.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1000';
  const content = document.createElement('div');
  content.style.cssText = 'background:#fff;border-radius:8px;padding:20px;max-width:400px;position:relative';
  const close = document.createElement('button');
  close.textContent = '✕';
  close.style.cssText = 'position:absolute;top:8px;right:8px;border:none;background:none;font-size:20px;cursor:pointer';
  close.addEventListener('click', () => modal.remove());
  content.appendChild(close);
  content.appendChild(Authenticator(authApi));
  modal.appendChild(content);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  // サインインできたらモーダルを閉じる。onAuthChange は購読時に現在の状態で同期発火するので、
  // 開いた時点の初回フレームは無視し（開いた瞬間に閉じないため）、その後 user が立つ遷移でのみ閉じる。
  let first = true;
  const unsub = onAuthChange(authApi, (u) => {
    if (first) {
      first = false;
      return;
    }
    if (u) {
      modal.remove();
      unsub();
    }
  });
  document.body.appendChild(modal);
}

// 本家 AccountMenuBar は `user.username` 固定表示なので、email を表示する版を自前で用意（B案）。
// mock=email / Cognito=UUID の不一致を、email 属性で統一する。
function AccountBar({ user }: { user: User | null }) {
  const signOut = async () => {
    // サインアウト（サーバ側 session 削除＋Cookie 破棄）後にページを reload する。
    // Blocks の auth 状態キャッシュ(cache.state)を更新する updateState は非 export のため
    // 自前バーからはキャッシュをクリアできず、放置すると次のサインインで Authenticator が
    // 古い状態（"Signed in as …"）を描画する。reload で確実にリセットして防ぐ。
    await authApi.setAuthState({ action: 'signOut' });
    window.location.reload();
  };
  const label = user?.attributes?.email ?? user?.username ?? '';
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #eee' }}>
      {user ? (
        <>
          <span style={{ fontSize: 14 }}>👤 {label}</span>
          <button onClick={signOut}>Sign Out</button>
        </>
      ) : (
        <button onClick={openSignInModal}>Sign In</button>
      )}
    </div>
  );
}

function Workspace() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [noteStatus, setNoteStatus] = useState('');

  const loadTodos = async () => {
    setTodos(await api.listTodos());
  };
  const addTodo = async () => {
    const content = title.trim();
    if (!content) return;
    await api.createTodo(content);
    setTitle('');
    loadTodos();
  };
  const removeTodo = async (id: string) => {
    await api.deleteTodo(id);
    loadTodos();
  };

  const loadNote = async () => {
    const { text } = await api.loadNote();
    setNote(text);
  };
  const saveNote = async () => {
    setNoteStatus('保存中…');
    try {
      await api.saveNote(note);
      setNoteStatus('保存しました ✓');
    } catch (e) {
      setNoteStatus(e instanceof Error ? `エラー: ${e.message}` : 'エラー');
    }
  };

  useEffect(() => {
    loadTodos().catch((e) => console.error('todos', e));
    loadNote().catch((e) => console.error('note', e));
  }, []);

  return (
    <>
      {/* ─── Todo（Blocks: DistributedTable・認証必須）─── */}
      <div className="panel blocks">
        <h2>📋 Todo（AWS Blocks / DistributedTable）</h2>
        <p className="src">client: aws-blocks ・ 認証必須（requireAuth）</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTodo()}
            placeholder="Todo を入力…"
            style={{ flex: 1 }}
          />
          <button onClick={addTodo}>追加</button>
        </div>
        <ul>
          {todos.length === 0 && <li style={{ color: '#999', listStyle: 'none' }}>（まだありません）</li>}
          {todos.map((t) => (
            <li key={t.id}>
              {t.content}{' '}
              <button style={{ padding: '2px 8px', fontSize: '0.8em' }} onClick={() => removeTodo(t.id)}>
                削除
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* ─── 共有メモ（Blocks: KVStore・認証必須）─── */}
      <div className="panel blocks">
        <h2>📝 共有メモ（AWS Blocks / KVStore）</h2>
        <p className="src">client: aws-blocks ・ 認証必須（requireAuth）</p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          style={{ width: '100%', boxSizing: 'border-box' }}
          placeholder="共有メモ…"
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <button onClick={saveNote}>保存</button>
          <button onClick={loadNote}>再読込</button>
          <span style={{ color: '#888', fontSize: '0.85em' }}>{noteStatus}</span>
        </div>
      </div>
    </>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);

  // ログイン状態を購読（サインイン/アウトで再描画）。
  useEffect(() => onAuthChange(authApi, (u) => setUser(u)), []);

  return (
    <div>
      <AccountBar user={user} />
      <h1>Amplify Gen2 + AWS Blocks PoC</h1>
      <p style={{ color: '#666', fontSize: '0.9em' }}>
        バックエンドは <strong>AWS Blocks</strong>。認証は <strong>Amplify ネイティブ Cognito</strong> を
        Blocks が <code>fromExisting</code> で消費。API は <strong>認証必須</strong>。
      </p>

      {!user && <p style={{ color: '#888' }}>サインインして始めてください。</p>}
      {user && <Workspace />}
    </div>
  );
}
