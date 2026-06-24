import { useEffect, useState } from 'react';
// Phase 2: バックエンドは全て AWS Blocks に一本化。frontend も Blocks クライアント1本。
// 接続先は全モード共通で Blocks の config.json（/.blocks-sandbox/config.json）から解決する。
// その config.json を「何で埋めるか」だけがモードで変わる（dev=dev server / cloud=amplify_outputs）。
import { api } from 'aws-blocks';

type Todo = { pk: string; id: string; content: string; createdAt: number };

export function App() {
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
    <div>
      <h1>Amplify Gen2 + AWS Blocks PoC</h1>
      <p style={{ color: '#666', fontSize: '0.9em' }}>
        <strong>Phase 2</strong>: バックエンドを <strong>AWS Blocks に一本化</strong>し、デプロイは
        Amplify(<code>ampx</code>)。Todo も共有メモも <strong>1つの Blocks クライアント・1つの設定</strong>で動く。
      </p>

      {/* ─── Todo（Blocks: DistributedTable）─── */}
      <div className="panel blocks">
        <h2>📋 Todo（AWS Blocks / DistributedTable）</h2>
        <p className="src">client: aws-blocks ・ config: .blocks-sandbox/config.json</p>
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

      {/* ─── 共有メモ（Blocks: KVStore）─── */}
      <div className="panel blocks">
        <h2>📝 共有メモ（AWS Blocks / KVStore）</h2>
        <p className="src">client: aws-blocks ・ config: .blocks-sandbox/config.json</p>
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
    </div>
  );
}
