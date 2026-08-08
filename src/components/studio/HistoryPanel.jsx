import { Clock3 } from 'lucide-react';

export default function HistoryPanel({
  title = 'Session history',
  description = 'Recent generations in this workspace.',
  items = [],
  emptyLabel = 'No generations yet.',
}) {
  return (
    <div className="gen-history">
      <div className="gen-history-head">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>

      <div className="gen-history-list">
        {items.length ? items.map((item) => (
          <article key={item.id} className={`gen-history-item ${item.active ? 'is-active' : ''}`}>
            {item.thumb ? <div className="gen-history-thumb">{item.thumb}</div> : null}
            <div className="gen-history-copy">
              <strong>{item.title}</strong>
              {item.meta ? <span>{item.meta}</span> : null}
              {item.time ? (
                <time>
                  <Clock3 size={12} />
                  {item.time}
                </time>
              ) : null}
            </div>
          </article>
        )) : (
          <p className="gen-history-empty">{emptyLabel}</p>
        )}
      </div>
    </div>
  );
}
