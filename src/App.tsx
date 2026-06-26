import { useEffect, useRef, useState } from 'react';
// バックエンドは AWS Blocks。認証は Amplify ネイティブ Cognito を Blocks が消費（fromExisting）。
// frontend は `aws-blocks` クライアント1本のまま（aws-amplify は使わない＝純 Blocks 維持）。
import { api, authApi } from 'aws-blocks';
import { AccountMenuBar, onAuthChange } from '@aws-blocks/blocks/ui';

type Todo = { pk: string; id: string; content: string; createdAt: number };
type User = { username: string; userId: string };

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
  const menuRef = useRef<HTMLDivElement>(null);

  // サインイン/アカウントメニュー（Blocks の auth UI。authApi が Cognito を駆動）。
  useEffect(() => {
    if (menuRef.current && !menuRef.current.hasChildNodes()) {
      menuRef.current.appendChild(AccountMenuBar(authApi));
    }
  }, []);
  // ログイン状態を購読（サインイン/アウトで再描画）。
  useEffect(() => onAuthChange(authApi, (u) => setUser(u)), []);

  return (
    <div>
      <div ref={menuRef} />
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
