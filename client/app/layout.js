import './globals.css';

export const metadata = {
  title: 'Poka — Open-Source Personal AI Agent Workspace',
  description: 'Poka is your personal AI workspace for conversations, connected apps, computer tasks, and background work.',
  openGraph: {
    title: 'Poka — Open-Source Personal AI Agent Workspace',
    description: 'Self-hostable AI chat, connectors, computer tasks, and approval-gated actions.',
    type: 'website',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning={true}>
      <body className="bg-background text-foreground antialiased" suppressHydrationWarning={true}>
        {children}
      </body>
    </html>
  );
}
