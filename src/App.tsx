import { useEffect, useState } from 'react';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import outputs from '../amplify_outputs.json';
// Blocks 側クライアント。ローカル(npm run dev)では Blocks dev server に、
// デプロイ時はホスティング配下の /.blocks-sandbox/config.json から API URL を解決する。
import { api as blocksApi } from 'aws-blocks';

// ─── Amplify ネイティブ backend（Todo: AppSync + DynamoDB）───────────────────
Amplify.configure(outputs);
const dataClient = generateClient<Schema>();

type Todo = Schema['Todo']['type'];

export function App() {
  // Amplify 側: Todo リスト
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState('');
  // Blocks 側: 共有メモ
  const [note, setNote] = useState('');
  const [noteStatus, setNoteStatus] = useState('');

  // Amplify Data client で Todo を読む（guest / identityPool）
  const loadTodos = async () => {
    const { data } = await dataClient.models.Todo.list({ authMode: 'identityPool' });
    setTodos(data);
  };
  const addTodo = async () => {
    const content = title.trim();
    if (!content) return;
    await dataClient.models.Todo.create({ content }, { authMode: 'identityPool' });
    setTitle('');
    loadTodos();
  };
  const removeTodo = async (id: string) => {
    await dataClient.models.Todo.delete({ id }, { authMode: 'identityPool' });
    loadTodos();
  };

  // Blocks client で共有メモを読む
  const loadNote = async () => {
    const { text } = await blocksApi.loadNote();
    setNote(text);
  };
  const saveNote = async () => {
    setNoteStatus('保存中…');
    try {
      await blocksApi.saveNote(note);
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
        1つの画面が <strong>2つのバックエンド</strong>にアクセスしています。
        Todo は <strong>Amplify ネイティブ</strong>（AppSync/DynamoDB）、共有メモは{' '}
        <strong>AWS Blocks</strong>（KVStore）。Phase 1 ではクライアントも設定も別系統です。
      </p>

      {/* ─── Amplify backend ─── */}
      <div className="panel amplify">
        <h2>📋 Todo（Amplify ネイティブ backend）</h2>
        <p className="src">client: aws-amplify/data ・ config: amplify_outputs.json</p>
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

      {/* ─── Blocks backend ─── */}
      <div className="panel blocks">
        <h2>📝 共有メモ（AWS Blocks backend）</h2>
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
