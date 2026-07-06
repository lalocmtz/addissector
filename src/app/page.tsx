'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Scan, Brain, Wand2, Layers, Sparkles, ArrowRight, Check,
  Upload, LineChart, Rocket, PlayCircle, ShieldCheck, Zap,
} from 'lucide-react';
import { BRAND, TIERS, type BillingCycle } from '@/lib/brand';

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-[#1e1e2e] bg-[#0a0a0f]/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl gradient-blue flex items-center justify-center">
            <Scan className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight">{BRAND.name}</span>
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-sm text-[#94a3b8]">
          <a href="#como-funciona" className="hover:text-[#f1f5f9] transition-colors">Cómo funciona</a>
          <a href="#features" className="hover:text-[#f1f5f9] transition-colors">Plataforma</a>
          <a href="#precios" className="hover:text-[#f1f5f9] transition-colors">Precios</a>
          <a href="#faq" className="hover:text-[#f1f5f9] transition-colors">FAQ</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="hidden sm:inline text-sm text-[#cbd5e1] hover:text-white transition-colors">
            Entrar
          </Link>
          <Link
            href="/signup"
            className="text-sm font-medium px-4 py-2 rounded-lg gradient-blue text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 transition-all"
          >
            Probar gratis
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pt-16 pb-20">
      <div className="absolute inset-0 -z-10 opacity-60"
        style={{ background: 'radial-gradient(600px 300px at 50% -10%, rgba(59,130,246,0.18), transparent), radial-gradient(500px 260px at 80% 10%, rgba(139,92,246,0.14), transparent)' }} />
      <div className="max-w-4xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
        >
          <span className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border border-[#1e1e2e] bg-[#111118] text-[#a78bfa] mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            La única plataforma que se paga sola: entiende tus ganadores y escálalos
          </span>
          <h1 className="text-4xl sm:text-6xl font-bold leading-[1.05] tracking-tight mb-5">
            <span className="text-[#f1f5f9]">Deja de adivinar</span><br />
            <span className="gradient-text">por qué un anuncio vende.</span>
          </h1>
          <p className="text-lg text-[#94a3b8] max-w-2xl mx-auto mb-8">
            Sube el anuncio que ya te funciona y recibe, en simple, por qué vende — más prompts
            para IA o un brief para tu equipo creativo para hacer más variantes. Como tener a un
            Creative Strategist senior a tu lado.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/signup"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl text-base font-semibold gradient-blue text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all"
            >
              Analizar mi primer creativo
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="#como-funciona"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl text-base font-medium border border-[#1e1e2e] text-[#cbd5e1] hover:border-[#3b82f6]/50 hover:text-white transition-all"
            >
              <PlayCircle className="w-4 h-4" />
              Ver cómo funciona
            </a>
          </div>
          <p className="text-xs text-[#64748b] mt-4">Sin tarjeta para empezar · Cancela cuando quieras</p>
        </motion.div>

        {/* Hero visual: mock scorecard */}
        <motion.div
          initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}
          className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-4 text-left"
        >
          {[
            { icon: <Brain className="w-5 h-5" />, k: 'Por qué convierte', v: 'Activa el dolor, prueba la solución y cierra con escasez en los primeros 3 segundos.', tag: 'Psicología' },
            { icon: <LineChart className="w-5 h-5" />, k: 'Scroll-stop', v: '8/10 — rostro en primer plano + claim de alto contraste.', tag: 'Score' },
            { icon: <Wand2 className="w-5 h-5" />, k: '3 variantes listas', v: 'Prompts de replicación para producir de nuevo con distinto ángulo.', tag: 'Replicar' },
          ].map((c) => (
            <div key={c.k} className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-[#1e1e2e] flex items-center justify-center text-[#8b5cf6]">{c.icon}</div>
                <span className="text-[10px] uppercase tracking-wide text-[#64748b]">{c.tag}</span>
              </div>
              <p className="text-sm font-semibold text-[#f1f5f9] mb-1">{c.k}</p>
              <p className="text-xs text-[#94a3b8] leading-relaxed">{c.v}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function ProblemSolution() {
  return (
    <section className="px-6 py-16 border-t border-[#1e1e2e]">
      <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-10 items-center">
        <div>
          <span className="text-xs uppercase tracking-wider text-[#f43f5e]">El problema</span>
          <h2 className="text-2xl sm:text-3xl font-bold mt-2 mb-4">Quemas presupuesto probando creativos a ciegas.</h2>
          <ul className="space-y-3 text-[#94a3b8] text-sm">
            <li>Un anuncio pega y no sabes exactamente por qué — así que no lo puedes repetir.</li>
            <li>Contratar UGC y editar variantes cuesta caro y tarda semanas.</li>
            <li>Las agencias cobran fortunas por “insights” que no puedes accionar.</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-[#8b5cf6]/30 bg-gradient-to-br from-[#1a1230] to-[#111118] p-6">
          <span className="text-xs uppercase tracking-wider text-[#a78bfa]">La solución</span>
          <h2 className="text-2xl sm:text-3xl font-bold mt-2 mb-4">{BRAND.name} convierte cada ganador en una fórmula.</h2>
          <p className="text-[#cbd5e1] text-sm leading-relaxed">
            Sube el creativo, {BRAND.name} lo disecciona: la psicología que lo hace vender, el desglose visual y de copy,
            y te entrega variantes con prompts listos para pegar en tu generador de IA o pasar a tu editor.
          </p>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { icon: <Upload className="w-6 h-6" />, t: 'Sube tu creativo', d: 'El video o imagen del anuncio que ya te está vendiendo. Sin configuración.' },
    { icon: <Brain className="w-6 h-6" />, t: 'Entiende por qué vende', d: 'Un veredicto en una frase, un score claro y la receta ganadora — en español simple, sin jerga.' },
    { icon: <Rocket className="w-6 h-6" />, t: 'Haz más como ese', d: 'Recibe prompts listos para IA o un brief claro para tu diseñador o editor. Tú eliges cómo producir.' },
  ];
  return (
    <section id="como-funciona" className="px-6 py-20 border-t border-[#1e1e2e]">
      <div className="max-w-5xl mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-bold mb-3">De ganador a fórmula en 3 pasos</h2>
        <p className="text-[#94a3b8] mb-12 max-w-xl mx-auto">
          El entregable es concreto: entiendes por qué vende tu anuncio y recibes prompts para IA
          o un brief para tu equipo creativo para hacer más variantes.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((s, i) => (
            <motion.div
              key={s.t}
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
              className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-6 text-left"
            >
              <div className="w-12 h-12 rounded-xl gradient-blue flex items-center justify-center text-white mb-4">{s.icon}</div>
              <div className="text-xs text-[#64748b] mb-1">Paso {i + 1}</div>
              <h3 className="text-lg font-semibold mb-2">{s.t}</h3>
              <p className="text-sm text-[#94a3b8] leading-relaxed">{s.d}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const feats = [
    { icon: <Brain className="w-6 h-6" />, t: 'Por qué convierte', d: 'La razón psicológica exacta por la que la gente compra — no generalidades.' },
    { icon: <LineChart className="w-6 h-6" />, t: 'Scores accionables', d: 'Scroll-stop, claridad, fuerza de oferta y visibilidad de marca, del 1 al 10.' },
    { icon: <Wand2 className="w-6 h-6" />, t: 'Variantes con prompt', d: 'Nuevos ángulos del mismo ganador, con el prompt listo para producir.' },
    { icon: <Layers className="w-6 h-6" />, t: 'Fórmula maestra', d: 'Cruza varios ganadores y extrae el patrón repetible de tu marca.' },
    { icon: <Zap className="w-6 h-6" />, t: 'Listo para tu generador de IA', d: 'Prompts estructurados para reproducir el creativo en la herramienta de IA que ya uses.' },
    { icon: <ShieldCheck className="w-6 h-6" />, t: 'Una marca por workspace', d: 'Organiza tus creativos por marca y mantén cada cuenta separada y ordenada.' },
  ];
  return (
    <section id="features" className="px-6 py-20 border-t border-[#1e1e2e]">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold mb-3">Tu mano derecha para creativos</h2>
          <p className="text-[#94a3b8] max-w-xl mx-auto">Menos ruido, más claridad. Todo lo que necesitas para entender y repetir lo que funciona.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {feats.map((f) => (
            <div key={f.t} className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-6 hover:border-[#3b82f6]/40 transition-colors">
              <div className="w-11 h-11 rounded-xl bg-[#1e1e2e] flex items-center justify-center text-[#3b82f6] mb-4">{f.icon}</div>
              <h3 className="font-semibold mb-2">{f.t}</h3>
              <p className="text-sm text-[#94a3b8] leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const router = useRouter();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [loading, setLoading] = useState<string | null>(null);

  const handleSelect = async (tierId: string) => {
    setLoading(tierId);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: tierId, cycle }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        // Sin cuenta todavía → registro y de ahí directo al checkout.
        router.push(`/signup?tier=${tierId}&cycle=${cycle}`);
        return;
      }
      if (data.url) {
        window.location.href = data.url; // Stripe Checkout
      } else {
        // Stripe aún no configurado → manda al registro para probar el producto.
        router.push('/signup');
      }
    } catch {
      router.push('/signup');
    } finally {
      setLoading(null);
    }
  };

  return (
    <section id="precios" className="px-6 py-20 border-t border-[#1e1e2e]">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold mb-3">Precios simples que escalan contigo</h2>
          <p className="text-[#94a3b8] mb-6">Empieza en minutos. Sube de plan cuando agregues marcas.</p>
          <div className="inline-flex gap-1 bg-[#111118] border border-[#1e1e2e] rounded-xl p-1">
            <button
              onClick={() => setCycle('monthly')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${cycle === 'monthly' ? 'bg-[#1e1e2e] text-white' : 'text-[#94a3b8]'}`}
            >
              Mensual
            </button>
            <button
              onClick={() => setCycle('annual')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${cycle === 'annual' ? 'bg-[#1e1e2e] text-white' : 'text-[#94a3b8]'}`}
            >
              Anual <span className="text-[#22c55e]">−2 meses</span>
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {TIERS.map((t) => {
            const price = cycle === 'monthly' ? t.priceMonthly : t.priceAnnual;
            return (
              <div
                key={t.id}
                className={`relative rounded-2xl border p-6 flex flex-col ${
                  t.featured
                    ? 'border-[#8b5cf6]/50 bg-gradient-to-b from-[#1a1230] to-[#111118] shadow-xl shadow-purple-500/10'
                    : 'border-[#1e1e2e] bg-[#111118]'
                }`}
              >
                {t.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wide px-3 py-1 rounded-full gradient-blue text-white">
                    Más popular
                  </span>
                )}
                <h3 className="text-lg font-semibold">{t.name}</h3>
                <p className="text-xs text-[#94a3b8] mt-1 mb-4 min-h-[32px]">{t.blurb}</p>
                <div className="flex items-end gap-1 mb-1">
                  <span className="text-4xl font-bold">${price}</span>
                  <span className="text-[#64748b] text-sm mb-1.5">/mes</span>
                </div>
                <p className="text-[11px] text-[#64748b] mb-5">
                  {cycle === 'annual' ? `Facturado anual · $${price * 12}/año` : 'Facturación mensual'}
                </p>
                <button
                  onClick={() => handleSelect(t.id)}
                  disabled={loading === t.id}
                  className={`w-full py-3 rounded-xl text-sm font-semibold transition-all mb-6 disabled:opacity-60 ${
                    t.featured
                      ? 'gradient-blue text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40'
                      : 'border border-[#2e2e42] text-[#f1f5f9] hover:border-[#3b82f6]/50'
                  }`}
                >
                  {loading === t.id ? 'Redirigiendo…' : t.cta}
                </button>
                <ul className="space-y-2.5 mt-auto">
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-[#cbd5e1]">
                      <Check className="w-4 h-4 text-[#22c55e] shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="text-center text-xs text-[#64748b] mt-6">
          Precios en USD. ¿Necesitas más volumen o facturación local (MXN)? <a href="#faq" className="text-[#3b82f6]">Escríbenos</a>.
        </p>
      </div>
    </section>
  );
}

function FAQ() {
  const qs = [
    { q: '¿Qué necesito para empezar?', a: 'Solo un anuncio que ya te esté funcionando (video o imagen). Creas tu cuenta, lo subes y en minutos tienes el veredicto. La prueba gratis incluye 3 análisis por 7 días, sin tarjeta.' },
    { q: '¿Sirve para cualquier ecommerce?', a: 'Sí. Funciona para cualquier producto o nicho: skincare, moda, suplementos, gadgets, servicios. El análisis se adapta al idioma y contexto de tu creativo.' },
    { q: '¿Genera los videos por mí?', a: 'No — y esa es la gracia: AdDNA interpreta por qué funciona tu creativo y te dicta cómo hacer más. Cada variante viene en dos formatos: un prompt listo para tu generador de IA (imagen o video) y un brief claro para tu diseñador o editor.' },
    { q: '¿Puedo manejar varias marcas?', a: 'Sí. Cada marca vive en su propio workspace. Growth incluye 3 y Scale marcas ilimitadas.' },
    { q: '¿Puedo cancelar cuando quiera?', a: 'Cuando quieras, desde tu portal de cliente. Sin contratos ni permanencia.' },
  ];
  return (
    <section id="faq" className="px-6 py-20 border-t border-[#1e1e2e]">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold mb-10 text-center">Preguntas frecuentes</h2>
        <div className="space-y-3">
          {qs.map((item) => (
            <details key={item.q} className="group rounded-xl border border-[#1e1e2e] bg-[#111118] p-5">
              <summary className="flex items-center justify-between cursor-pointer list-none font-medium text-[#f1f5f9]">
                {item.q}
                <ArrowRight className="w-4 h-4 text-[#64748b] group-open:rotate-90 transition-transform" />
              </summary>
              <p className="text-sm text-[#94a3b8] mt-3 leading-relaxed">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="px-6 py-20 border-t border-[#1e1e2e]">
      <div className="max-w-3xl mx-auto text-center rounded-3xl border border-[#3b82f6]/30 bg-gradient-to-br from-[#132038] to-[#111118] p-10">
        <h2 className="text-3xl sm:text-4xl font-bold mb-3">Escala lo que ya funciona.</h2>
        <p className="text-[#94a3b8] mb-8 max-w-lg mx-auto">
          Deja de reinventar creativos desde cero. Entiende tus ganadores y multiplícalos.
        </p>
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 px-8 py-4 rounded-xl text-base font-semibold gradient-blue text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all"
        >
          Empezar gratis
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[#1e1e2e] px-6 py-10">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[#64748b]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg gradient-blue flex items-center justify-center">
            <Scan className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-[#cbd5e1]">{BRAND.name}</span>
        </div>
        <p className="text-xs">© {new Date().getFullYear()} {BRAND.name}. {BRAND.tagline}</p>
        <div className="flex items-center gap-5 text-xs">
          <a href="#precios" className="hover:text-[#cbd5e1]">Precios</a>
          <a href="#faq" className="hover:text-[#cbd5e1]">FAQ</a>
          <Link href="/login" className="hover:text-[#cbd5e1]">Entrar</Link>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <main className="flex-1">
      <Nav />
      <Hero />
      <ProblemSolution />
      <HowItWorks />
      <Features />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </main>
  );
}
