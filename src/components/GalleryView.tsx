import { useMemo, useRef, useState } from 'react';
import type { ImageNote } from '../types';
import { useApp } from '../contexts/AppContext';
import { formatDate, todayISO } from '../lib/date';
import { MAX_IMAGES_PER_DAY } from '../lib/images';
import { Modal } from './Modal';
import { SubjectBadge } from './SubjectBadge';
import { Icon } from './Icons';

export function GalleryView() {
  const { data, addImages, deleteImage, imageUsage, selectedDate, setSelectedDate } = useApp();
  const [date, setDate] = useState(selectedDate || todayISO());
  const [subjectId, setSubjectId] = useState('');
  const [caption, setCaption] = useState('');
  const [filterSubject, setFilterSubject] = useState('all');
  const [preview, setPreview] = useState<ImageNote | undefined>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const images = useMemo(() => {
    return data.images
      .filter((image) => filterSubject === 'all' || image.subjectId === filterSubject)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [data.images, filterSubject]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ImageNote[]>();
    for (const image of images) {
      const list = groups.get(image.date) || [];
      list.push(image);
      groups.set(image.date, list);
    }
    return Array.from(groups.entries());
  }, [images]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError('');
    try {
      const result = await addImages(date, Array.from(files), subjectId || undefined, caption);
      if (result.error) setError(result.error);
      if (result.added) {
        setCaption('');
        setSelectedDate(date);
        if (inputRef.current) inputRef.current.value = '';
      }
    } finally {
      setUploading(false);
    }
  };

  const dayCount = data.images.filter((image) => image.date === date).length;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Notes / mistakes archive</div>
          <h1 className="page-title">錯題相簿</h1>
          <p className="page-subtitle">
            每日可以上傳多張手寫筆記、錯題紙；按日期與科目歸檔。第一版只存在此瀏覽器，不會上傳 Firebase Storage。
          </p>
        </div>
        <div className="row">
          <span className="chip">{imageUsage.count} 張</span>
          <span className="chip">{(imageUsage.bytes / 1024 / 1024).toFixed(2)} MB / 約 4 MB</span>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">New capture</div>
            <div className="card-title" style={{ marginTop: 5 }}>
              <Icon name="upload" size={15} />
              加入今日筆記
            </div>
          </div>
          <span className="tiny muted">每日最多 {MAX_IMAGES_PER_DAY} 張 · 自動壓縮 WebP</span>
        </div>
        <div className="card-body">
          <div className="gallery-toolbar">
            <label className="field">
              <span className="label">日期</span>
              <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className="field">
              <span className="label">科目</span>
              <select className="select" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                <option value="">未分類</option>
                {data.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>{subject.name}</option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: '1 1 220px' }}>
              <span className="label">標題 / 備註</span>
              <input className="input" value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="例：數學錯題 — 圓形幾何 Q14" maxLength={120} />
            </label>
            <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={uploading}>
              <Icon name="upload" size={14} />
              {uploading ? '處理中…' : '選擇圖片'}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => void upload(event.target.files)}
            />
          </div>
          <div
            className="upload-zone"
            style={{ marginTop: 12 }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void upload(event.dataTransfer.files);
            }}
          >
            <div className="upload-copy">
              <span className="upload-icon"><Icon name="image" size={17} /></span>
              <div>
                <div className="card-title">拖曳或選擇圖片</div>
                <div className="help">支援 JPG / PNG / WebP；會先縮至 1280px 並轉 WebP，減少 localStorage 用量。</div>
              </div>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
              瀏覽檔案
            </button>
          </div>
          <div className="storage-line">
            <span>{formatDate(date, { month: 'long', day: 'numeric', weekday: 'short' })} · 已上傳 {dayCount} 張</span>
            <span className="mono">{imageUsage.percent}% local quota</span>
          </div>
          <div className="quota-bar" style={{ marginTop: 5 }}>
            <div className={`quota-fill ${imageUsage.percent >= 85 ? 'danger' : imageUsage.percent >= 60 ? 'warn' : ''}`} style={{ width: `${imageUsage.percent}%` }} />
          </div>
          {error ? <div className="notice exam" style={{ marginTop: 12 }}>{error}</div> : null}
          <div className="notice" style={{ marginTop: 12 }}>
            <Icon name="lock" size={15} />
            <span>圖片只存此裝置的 localStorage。清除瀏覽器資料、換裝置或匯出 JSON 前，請先備份。Spark 免費層不提供 Firebase Storage 配額，所以第一版刻意不上傳。</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">Archive</div>
            <div className="card-title" style={{ marginTop: 5 }}>
              <Icon name="image" size={15} />
              按日期歸檔
            </div>
          </div>
          <select className="select" style={{ width: 150, height: 30 }} value={filterSubject} onChange={(event) => setFilterSubject(event.target.value)}>
            <option value="all">所有科目</option>
            {data.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </select>
        </div>
        {grouped.length ? (
          <div className="card-body">
            {grouped.map(([groupDate, notes]) => (
              <div key={groupDate}>
                <div className="gallery-date-head">
                  <span>{formatDate(groupDate, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}</span>
                  <span>{notes.length} 張</span>
                </div>
                <div className="image-grid">
                  {notes.map((image) => {
                    const subject = data.subjects.find((item) => item.id === image.subjectId);
                    return (
                      <article className="image-card" key={image.id}>
                        <div
                          className="image-preview"
                          role="button"
                          tabIndex={0}
                          onClick={() => setPreview(image)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setPreview(image);
                            }
                          }}
                        >
                          <img src={image.dataUrl} alt={image.caption || '學習筆記'} loading="lazy" />
                          <button
                            type="button"
                            className="image-delete icon-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (window.confirm('刪除這張圖片？')) deleteImage(image.id);
                            }}
                            aria-label="刪除圖片"
                          >
                            <Icon name="trash" size={12} />
                          </button>
                        </div>
                        <div className="image-meta">
                          <div className="image-title">{image.caption}</div>
                          <div className="image-sub">
                            <span>{subject?.name || '未分類'}</span>
                            <span className="mono">{(image.bytes / 1024).toFixed(0)} KB</span>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon"><Icon name="image" /></div>
            <div className="empty-title">錯題庫仍是空白</div>
            <div className="empty-copy">今日開始，每日影一張最值得重看的錯題。相片會自動按日期和科目歸檔。</div>
          </div>
        )}
      </section>

      {preview ? (
        <Modal
          title={preview.caption || '筆記圖片'}
          eyebrow={`${formatDate(preview.date, { year: 'numeric', month: 'long', day: 'numeric' })}${preview.subjectId ? ` · ${data.subjects.find((subject) => subject.id === preview.subjectId)?.name || ''}` : ''}`}
          onClose={() => setPreview(undefined)}
          wide
          footer={
            <>
              <button type="button" className="btn btn-danger" onClick={() => { deleteImage(preview.id); setPreview(undefined); }}>
                刪除
              </button>
              <button type="button" className="btn" onClick={() => setPreview(undefined)}>關閉</button>
            </>
          }
        >
          <img className="modal-preview" src={preview.dataUrl} alt={preview.caption || '學習筆記'} />
          <div className="between" style={{ marginTop: 10 }}>
            <span className="tiny muted">{formatDate(preview.date, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            <span className="tiny muted">{preview.subjectId ? <SubjectBadge subject={data.subjects.find((subject) => subject.id === preview.subjectId)} /> : null}</span>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
