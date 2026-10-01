import Link from 'next/link';
import BrandIcon from '../components/BrandIcon';

const alternatives = [
  ['meta-muse', 'Meta Muse'],
  ['grok-bot', 'Grok Bot'],
  ['instinct', 'Instinct'],
  ['manus-cue', 'Manus Cue'],
  ['openclaw', 'OpenClaw'],
  ['claude-cowork', 'Claude Cowork'],
  ['chatgpt-agent', 'ChatGPT agent'],
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#09090b] text-zinc-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-3 text-lg font-semibold"><BrandIcon />Poka</Link>
        <nav className="flex items-center gap-5 text-sm text-zinc-300">
          <a href="https://github.com/xAmirHamza77/Poka-Bot">GitHub</a>
          <Link href="/app" className="rounded-lg bg-white px-4 py-2 font-medium text-zinc-950">Open the app</Link>
        </nav>
      </header>

      <section className="landing-hero mx-auto max-w-6xl px-6 pb-20 pt-16 md:pt-24">
        <p className="mb-5 text-sm font-medium uppercase tracking-[0.2em] text-violet-300">Open source · self hosted · MIT licensed</p>
        <h1 className="max-w-4xl text-4xl font-semibold tracking-tight md:text-6xl">Your ideas. Your agents.
          <span className="block text-violet-300">Your own workspace.</span></h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-300">Bring conversations, tools, and computer tasks together in one personal AI workspace. Create assistants for the way you work, choose your models, and stay in control of every action.</p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link href="/app" className="rounded-lg bg-violet-500 px-5 py-3 font-medium text-white hover:bg-violet-400">Open your workspace →</Link>
          <a href="https://github.com/xAmirHamza77/Poka-Bot" className="rounded-lg border border-zinc-700 px-5 py-3 font-medium hover:bg-zinc-900">View source on GitHub</a>
        </div>
        <p className="mt-4 text-sm text-zinc-500">Self-hosted. MIT licensed. Built for local experimentation.</p>
      </section>

      <section className="border-y border-zinc-800 bg-zinc-950/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-3">
          <article><h2 className="text-lg font-semibold">Self-hosted AI workspace</h2><p className="mt-2 leading-7 text-zinc-400">Conversation and app state use local SQLite storage. Provider credentials are encrypted at rest.</p></article>
          <article><h2 className="text-lg font-semibold">Visible action controls</h2><p className="mt-2 leading-7 text-zinc-400">A deny-by-default action gateway routes higher-risk operations through approval prompts and audit events.</p></article>
          <article><h2 className="text-lg font-semibold">Open implementation</h2><p className="mt-2 leading-7 text-zinc-400">MIT-licensed code, a configurable inference adapter, Composio connectors, and an optional Docker/Playwright computer runtime.</p></article>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-semibold">Compare Poka with personal AI agents</h2>
        <p className="mt-3 max-w-3xl leading-7 text-zinc-400">Looking for an open-source alternative to one of these products? Read the product-specific comparison, including what Poka does and does not currently replace.</p>
        <ul className="mt-7 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {alternatives.map(([slug, name]) => <li key={slug}><Link className="block rounded-xl border border-zinc-800 p-4 hover:border-violet-500" href={`/alternatives/${slug}`}>Poka vs {name}<span className="mt-1 block text-sm text-zinc-500">Open-source alternative overview →</span></Link></li>)}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <h2 className="text-2xl font-semibold">What Poka can do today</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <p className="rounded-xl border border-zinc-800 p-5 leading-7 text-zinc-300">Create assistant personas, stream chats, attach images, select configured models, and connect supported apps through narrowly scoped actions.</p>
          <p className="rounded-xl border border-zinc-800 p-5 leading-7 text-zinc-300">Request workspace and computer operations through an action gateway. Use the optional computer provider in Docker or connect a compatible remote service.</p>
        </div>
        <p className="mt-5 max-w-4xl text-sm leading-6 text-zinc-500">Poka is independently built and is not affiliated with or endorsed by OpenAI, Meta, xAI, Instinct, or Manus. It does not currently include persistent long-term memory, scheduled routines, a mobile app, multi-user roles, or a hardened sandbox for arbitrary web content.</p>
      </section>
      <section className="border-y border-zinc-800 bg-zinc-950/60">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="text-2xl font-semibold">Is Poka the right AI agent alternative for you?</h2>
          <p className="mt-4 max-w-4xl leading-7 text-zinc-300">Choose Poka if you are comfortable running software yourself and want to inspect an AI workspace with visible approval steps. It is not the best fit if you need a polished mobile assistant, persistent memory, scheduled work, broad everyday app access, or a managed computer that keeps running in the cloud.</p>
          <h2 className="mt-10 text-2xl font-semibold">Questions about this open-source AI agent</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <article className="rounded-xl border border-zinc-800 p-5"><h3 className="font-semibold">Can I self-host Poka?</h3><p className="mt-2 leading-7 text-zinc-300">Yes. The API and web client can be run on infrastructure you control. You’ll need to configure a compatible inference service and follow the setup and security notes in the README.</p></article>
            <article className="rounded-xl border border-zinc-800 p-5"><h3 className="font-semibold">Which AI models does Poka support?</h3><p className="mt-2 leading-7 text-zinc-300">Configure your model IDs and connect a service using the supported Prediction or Responses API protocol. See the README for the provider requirements.</p></article>
            <article className="rounded-xl border border-zinc-800 p-5"><h3 className="font-semibold">Is Poka a replacement for these personal agents?</h3><p className="mt-2 leading-7 text-zinc-300">It is an open-source project to evaluate when self-hosting and inspecting the implementation matter. It is still a prototype and does not match the feature set or convenience of the managed products.</p></article>
            <article className="rounded-xl border border-zinc-800 p-5"><h3 className="font-semibold">Is Poka safe for unattended computer use?</h3><p className="mt-2 leading-7 text-zinc-300">The project routes higher-risk operations through approvals, but its optional computer runtime is not hardened for hostile websites. It is intended for local experimentation; review the limitations before deployment.</p></article>
          </div>
        </div>
      </section>
      <footer className="border-t border-zinc-800 px-6 py-8 text-center text-sm text-zinc-500">Poka · MIT license · <a className="hover:text-white" href="https://github.com/xAmirHamza77/Poka-Bot">Source code</a></footer>
    </main>
  );
}
