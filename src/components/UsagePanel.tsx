import { useApp } from '../contexts/AppContext';
import { SPARK_READ_LIMIT, SPARK_WRITE_LIMIT, usagePercent } from '../lib/usage';
import { Icon } from './Icons';

function quotaClass(percent: number): string {
  if (percent >= 85) return 'danger';
  if (percent >= 60) return 'warn';
  return '';
}

export function UsagePanel({ compact = false }: { compact?: boolean }) {
  const { usage, resetUsage, imageUsage } = useApp();
  const readPercent = usagePercent(usage.reads, SPARK_READ_LIMIT);
  const writePercent = usagePercent(usage.writes, SPARK_WRITE_LIMIT);

  return (
    <section className="card usage-panel">
      <div className="between">
        <div>
          <div className="eyebrow">Spark quota / estimate</div>
          <div className="card-title" style={{ marginTop: 5 }}>
            <Icon name="chart" size={15} />
            今日用量估算
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={resetUsage}>
          重設
        </button>
      </div>

      <div className="quota-row">
        <div className="quota-head">
          <span>Firestore reads</span>
          <strong>
            {usage.reads.toLocaleString()} / {SPARK_READ_LIMIT.toLocaleString()}
          </strong>
        </div>
        <div className="quota-bar">
          <div className={`quota-fill ${quotaClass(readPercent)}`} style={{ width: `${readPercent}%` }} />
        </div>
      </div>

      <div className="quota-row">
        <div className="quota-head">
          <span>Firestore writes</span>
          <strong>
            {usage.writes.toLocaleString()} / {SPARK_WRITE_LIMIT.toLocaleString()}
          </strong>
        </div>
        <div className="quota-bar">
          <div className={`quota-fill ${quotaClass(writePercent)}`} style={{ width: `${writePercent}%` }} />
        </div>
      </div>

      {!compact ? (
        <>
          <div className="storage-line">
            <span>本機圖片（localStorage）</span>
            <span className="mono">{(imageUsage.bytes / 1024 / 1024).toFixed(2)} MB</span>
          </div>
          <div className="quota-bar" style={{ marginTop: 5 }}>
            <div className={`quota-fill ${quotaClass(imageUsage.percent)}`} style={{ width: `${imageUsage.percent}%` }} />
          </div>
          <div className="usage-foot">
            這是目前登入帳戶的前端操作估算，不是 Firebase 官方帳單；專案總量請看 Firebase Console。Spark 每日上限為 50k reads / 20k writes；用完當日會停用，不會自動收費。
            <br />
            排行榜頁每 60 秒只讀取一次已公開的 <span className="mono">leaderboard</span> 文件；頁面隱藏或離開即停止輪詢，不會保持即時 listener。
          </div>
        </>
      ) : null}
    </section>
  );
}
