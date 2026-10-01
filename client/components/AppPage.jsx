'use client';

export default function AppPage({ title, description, actions, children, className = '' }) {
  return <section className={`app-page ${className}`}>
    <header className="app-page-header">
      <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
      <div className="app-page-actions">{actions}</div>
    </header>
    <div className="app-page-body">{children}</div>
  </section>;
}
