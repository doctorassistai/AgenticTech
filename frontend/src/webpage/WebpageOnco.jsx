import React, { useState } from 'react';
import {
  Menu, X, Sparkles, ArrowRight, Play, Building2, Stethoscope,
  Activity, Video, FileText, Clock, Database, AlertTriangle,
  Brain, BarChart3, Timer, Shield, Cpu, Lightbulb, UserCheck,
  TrendingUp, Users, Zap, Heart, Link, Lock, Eye, FileCheck,
  Server, Quote, Calendar, BrainCircuit, ScanHeart, HandHeart,
  Dna, Microscope, Pill, ClipboardList, MessageSquare, FileSignature,
  ShieldCheck, Network, GitBranch, Clock3, ClipboardCheck, Ambulance
} from "lucide-react";
import bgImage from '../assets/bg_image.png';

const styles = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,100..900;1,100..900&family=Open+Sans:ital,wght@0,300..800;1,300..800&display=swap');

:root {
  font-family: 'Open Sans', -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  --primary: #00f0ff;
  --primary-foreground: #000000;
  --secondary: #00d2ff;
  --background: #000000;
  --foreground: #ffffff;
  --muted: #1a1a1a;
  --muted-foreground: #a1a1aa;
  --border: rgba(255, 255, 255, 0.1);
  --accent: #7928ca;
  --destructive: #ff0055;

  color-scheme: dark;
  color: var(--foreground);
  background-color: var(--background);

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  display: block;
  min-width: 320px;
  min-height: 100vh;
  overflow-x: hidden;
  background-color: var(--background);
  font-family: 'Open Sans', sans-serif;
}

h1, h2, h3, h4, h5, h6 {
  font-family: 'Montserrat', sans-serif;
}

.font-bold, .font-semibold, .font-medium, strong, b {
  font-family: 'Montserrat', sans-serif;
}

.container {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1rem;
}

@media (min-width: 640px) {
  .container {
    padding: 0 1.5rem;
  }
}

.text-center { text-align: center; }
.text-left { text-align: left; }
.relative { position: relative; }
.absolute { position: absolute; }
.inset-0 { top: 0; right: 0; bottom: 0; left: 0; }
.flex { display: flex; }
.flex-col { flex-direction: column; }
.items-center { align-items: center; }
.justify-center { justify-content: center; }
.justify-between { justify-content: space-between; }
.gap-2 { gap: 0.5rem; }
.gap-3 { gap: 0.75rem; }
.gap-4 { gap: 1rem; }
.gap-6 { gap: 1.5rem; }
.gap-8 { gap: 2rem; }
.gap-12 { gap: 3rem; }
.mb-1 { margin-bottom: 0.25rem; }
.mb-2 { margin-bottom: 0.5rem; }
.mb-4 { margin-bottom: 1rem; }
.mb-6 { margin-bottom: 1.5rem; }
.mb-8 { margin-bottom: 2rem; }
.mb-10 { margin-bottom: 2.5rem; }
.mb-12 { margin-bottom: 3rem; }
.mb-16 { margin-bottom: 4rem; }
.mt-1 { margin-top: 0.25rem; }
.mt-2 { margin-top: 0.5rem; }
.mt-4 { margin-top: 1rem; }
.mt-8 { margin-top: 2rem; }
.mt-16 { margin-top: 4rem; }
.mt-24 { margin-top: 6rem; }
.p-2 { padding: 0.5rem; }
.p-3 { padding: 0.75rem; }
.p-4 { padding: 1rem; }
.p-5 { padding: 1.25rem; }
.p-6 { padding: 1.5rem; }
.p-8 { padding: 2rem; }
.p-12 { padding: 3rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
.py-4 { padding-top: 1rem; padding-bottom: 1rem; }
.py-16 { padding-top: 4rem; padding-bottom: 4rem; }
.py-24 { padding-top: 6rem; padding-bottom: 6rem; }
.pt-4 { padding-top: 1rem; }
.pt-20 { padding-top: 5rem; }
.pb-4 { padding-bottom: 1rem; }
.rounded-lg { border-radius: 0.5rem; }
.rounded-xl { border-radius: 0.75rem; }
.rounded-2xl { border-radius: 1rem; }
.rounded-3xl { border-radius: 1.5rem; }
.rounded-full { border-radius: 9999px; }
.w-full { width: 100%; }
.h-full { height: 100%; }
.w-2 { width: 0.5rem; }
.h-2 { height: 0.5rem; }
.w-4 { width: 1rem; }
.h-4 { height: 1rem; }
.w-5 { width: 1.25rem; }
.h-5 { height: 1.25rem; }
.w-6 { width: 1.5rem; }
.h-6 { height: 1.5rem; }
.w-7 { width: 1.75rem; }
.h-7 { height: 1.75rem; }
.w-8 { width: 2rem; }
.h-8 { height: 2rem; }
.w-10 { width: 2.5rem; }
.h-10 { height: 2.5rem; }
.w-12 { width: 3rem; }
.h-12 { height: 3rem; }
.w-14 { width: 3.5rem; }
.h-14 { height: 3.5rem; }
.w-16 { width: 4rem; }
.h-16 { height: 4rem; }
.w-24 { width: 6rem; }
.h-24 { height: 6rem; }
.w-80 { width: 20rem; }
.h-80 { height: 20rem; }
.w-96 { width: 24rem; }
.h-96 { height: 24rem; }
.max-w-xs { max-width: 20rem; }
.max-w-sm { max-width: 24rem; }
.max-w-2xl { max-width: 42rem; }
.max-w-4xl { max-width: 56rem; }
.max-w-5xl { max-width: 64rem; }
.max-w-6xl { max-width: 72rem; }
.mx-auto { margin-left: auto; margin-right: auto; }
.font-bold { font-weight: 700; }
.font-semibold { font-weight: 600; }
.font-medium { font-weight: 500; }
.font-light { font-weight: 300; }
.text-xs { font-size: 0.75rem; line-height: 1rem; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-base { font-size: 1rem; line-height: 1.5rem; }
.text-lg { font-size: 1.125rem; line-height: 1.75rem; }
.text-xl { font-size: 1.25rem; line-height: 1.75rem; }
.text-2xl { font-size: 1.5rem; line-height: 2rem; }
.text-3xl { font-size: 1.875rem; line-height: 2.25rem; }
.text-4xl { font-size: 2.25rem; line-height: 2.5rem; }
.text-5xl { font-size: 3rem; line-height: 1; }
.text-6xl { font-size: 3.75rem; line-height: 1; }
.text-7xl { font-size: 4.5rem; line-height: 1; }
.leading-tight { line-height: 1.25; }
.leading-relaxed { line-height: 1.625; }
.text-muted-foreground { color: var(--muted-foreground); }
.text-primary { color: var(--primary); }
.text-primary-foreground { color: var(--primary-foreground); }
.text-destructive { color: var(--destructive); }
.text-foreground { color: var(--foreground); }
.text-white { color: #ffffff; }
.bg-primary { background-color: var(--primary); }
.bg-black { background-color: #000000; }
.border-b { border-bottom-width: 1px; }
.border-t { border-top-width: 1px; }
.border-border { border-color: var(--border); }
.transition-colors { transition: color 0.2s, background-color 0.2s; }
.transition-all { transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.transition-transform { transition-property: transform; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.duration-300 { transition-duration: 300ms; }
.duration-500 { transition-duration: 500ms; }
.duration-700 { transition-duration: 700ms; }
.overflow-hidden { overflow: hidden; }
.overflow-x-hidden { overflow-x: hidden; }
.hidden { display: none; }
.z-5 { z-index: 5; }
.z-10 { z-index: 10; }
.z-50 { z-index: 50; }
.fixed { position: fixed; }
.top-0 { top: 0; }
.left-0 { left: 0; }
.right-0 { right: 0; }
.flex-shrink-0 { flex-shrink: 0; }
.flex-1 { flex: 1 1 0%; }
.flex-wrap { flex-wrap: wrap; }
.min-h-screen { min-height: 100vh; }
.pointer-events-none { pointer-events: none; }

.grid { display: grid; }
.grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }

@media (min-width: 640px) {
  .sm\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sm\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .sm\\:flex-row { flex-direction: row; }
}

@media (min-width: 768px) {
  .md\\:flex { display: flex; }
  .md\\:hidden { display: none; }
  .md\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .md\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .md\\:col-span-2 { grid-column: span 2 / span 2; }
  .md\\:flex-row { flex-direction: row; }
  .md\\:p-12 { padding: 3rem; }
  .md\\:p-16 { padding: 4rem; }
  .md\\:text-xl { font-size: 1.25rem; line-height: 1.75rem; }
  .md\\:text-4xl { font-size: 2.25rem; line-height: 2.5rem; }
  .md\\:text-5xl { font-size: 3rem; line-height: 1; }
}

@media (min-width: 1024px) {
  .lg\\:flex { display: flex; }
  .lg\\:hidden { display: none; }
  .lg\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .lg\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .lg\\:grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .lg\\:grid-cols-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .lg\\:grid-cols-6 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .lg\\:col-span-2 { grid-column: span 2 / span 2; }
  .lg\\:text-5xl { font-size: 3rem; line-height: 1; }
  .lg\\:text-6xl { font-size: 3.75rem; line-height: 1; }
}

@media (min-width: 1280px) {
  .xl\\:text-7xl { font-size: 4.5rem; line-height: 1; }
}

.glass-card {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
}

.glass-card-hover {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  transition: all 0.3s ease;
  will-change: transform, border-color, background-color;
}

.glass-card-hover:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(0, 240, 255, 0.3);
  transform: translateY(-2px);
  box-shadow: 0 10px 40px -10px rgba(0, 240, 255, 0.1);
}

.gradient-text {
  background: linear-gradient(135deg, var(--primary) 0%, #00d2ff 50%, #fff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.glow-text {
  text-shadow: 0 0 20px rgba(0, 240, 255, 0.5);
}

.hero-gradient {
  background: radial-gradient(circle at 50% 0%, rgba(0, 240, 255, 0.1) 0%, transparent 70%);
}

.animated-gradient {
  background: linear-gradient(-45deg, #000000, #1a1a1a, #001f2b, #000000);
  background-size: 400% 400%;
  animation: gradient 15s ease infinite;
}

@keyframes gradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.section-gradient {
  background: radial-gradient(circle at 50% 50%, rgba(0, 240, 255, 0.03) 0%, transparent 50%);
  pointer-events: none;
}

.dashboard-glow {
  box-shadow: 0 0 50px -10px rgba(0, 240, 255, 0.15);
  border: 1px solid rgba(0, 240, 255, 0.2);
}

.glow-line {
  height: 1px;
  width: 100%;
  background: linear-gradient(90deg, transparent, rgba(0, 240, 255, 0.5), transparent);
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.5);
}

.icon-glow {
  filter: drop-shadow(0 0 8px rgba(0, 240, 255, 0.5));
}

.btn-primary-glow {
  background: var(--primary);
  color: #000;
  padding: 0.75rem 1.5rem;
  border-radius: 0.5rem;
  font-weight: 600;
  transition: all 0.2s;
  box-shadow: 0 0 20px rgba(0, 240, 255, 0.3);
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  text-decoration: none;
  will-change: transform, box-shadow;
}

.btn-primary-glow:hover {
  box-shadow: 0 0 30px rgba(0, 240, 255, 0.5);
  transform: translateY(-1px);
}

.btn-secondary-glow {
  background: transparent;
  color: var(--foreground);
  padding: 0.75rem 1.5rem;
  border-radius: 0.5rem;
  font-weight: 600;
  border: 1px solid var(--border);
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  text-decoration: none;
  will-change: border-color, background-color;
}

.btn-secondary-glow:hover {
  border-color: var(--primary);
  background: rgba(0, 240, 255, 0.05);
}

.group:hover .group-hover\\:bg-primary\\/20 { background-color: rgba(0, 240, 255, 0.2); }
.group:hover .group-hover\\:scale-110 { transform: scale(1.1); }
.group:hover .group-hover\\:translate-x-1 { transform: translateX(0.25rem); }
.group\\/btn:hover .group-hover\\/btn\\:translate-x-1 { transform: translateX(0.25rem); }
.group\\/btn:hover .group-hover\\/btn\\:translate-x-full { transform: translateX(100%); }
.group\\/feature:hover .group-hover\\/feature\\:text-white { color: #ffffff; }

.pulse-glow { animation: pulse-glow 4s infinite ease-in-out; }

@keyframes pulse-glow {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.05); }
}

@keyframes pulse-glow-orb {
  0%, 100% { opacity: 0.2; transform: scale(1); }
  50% { opacity: 0.3; transform: scale(1.05); }
}

@keyframes float-orb-1 {
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(30px, -20px); }
  50% { transform: translate(10px, 25px); }
  75% { transform: translate(-25px, -10px); }
}

@keyframes float-orb-2 {
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(-20px, 30px); }
  50% { transform: translate(15px, -15px); }
  75% { transform: translate(-30px, -20px); }
}

@keyframes float-particle {
  0%, 100% { transform: translate(0, 0); opacity: 0.1; }
  25% { transform: translate(10px, -5px); opacity: 0.2; }
  50% { transform: translate(-8px, 8px); opacity: 0.15; }
  75% { transform: translate(5px, 12px); opacity: 0.18; }
}

@keyframes grid-move-horizontal {
  0% { transform: translateX(calc(-60px - 100%)); opacity: 0; }
  5% { opacity: 0.4; }
  95% { opacity: 0.4; }
  100% { transform: translateX(100vw); opacity: 0; }
}

@keyframes grid-move-vertical {
  0% { transform: translateY(calc(-60px - 100%)); opacity: 0; }
  5% { opacity: 0.4; }
  95% { opacity: 0.4; }
  100% { transform: translateY(100vh); opacity: 0; }
}

@keyframes slide-up-fade {
  0% { opacity: 0; transform: translateY(10px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes fade-in-up {
  0% { opacity: 0; transform: translateY(20px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes fade-in-bounce {
  0% { opacity: 0; transform: translateY(10px); }
  60% { opacity: 1; transform: translateY(-5px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes fade-in {
  0% { opacity: 0; }
  100% { opacity: 1; }
}

@keyframes line-expand {
  0% { transform: scaleX(0); opacity: 0; }
  100% { transform: scaleX(1); opacity: 1; }
}

@keyframes button-enter {
  0% { opacity: 0; transform: translateY(10px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes card-enter {
  0% { opacity: 0; transform: translateY(20px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes pulse-dot {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.2); }
}

.animate-fade-in-up { animation: fade-in-up 0.8s ease-out forwards; }

.grid-overlay {
  position: absolute;
  inset: 0;
  overflow: hidden;
  opacity: 0.15;
  pointer-events: none;
}

.grid-cell {
  position: absolute;
  border: 1px solid rgba(0, 240, 255, 0.3);
  will-change: transform, opacity;
  transform: translate3d(0, 0, 0);
}

.grid-cell::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, rgba(0, 240, 255, 0.3), transparent);
  animation: pulse-cell 4s ease-in-out infinite;
}

@keyframes pulse-cell {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 0.5; }
}

@media (max-width: 639px) {
  .py-24 { padding-top: 3rem; padding-bottom: 3rem; }
  .py-16 { padding-top: 2rem; padding-bottom: 2rem; }
  .text-3xl { font-size: 1.5rem; line-height: 2rem; }
  .text-4xl { font-size: 1.875rem; line-height: 2.25rem; }
  .text-5xl { font-size: 2.25rem; line-height: 2.5rem; }
  .gap-12 { gap: 2rem; }
  .gap-8 { gap: 1.5rem; }
  .mb-16 { margin-bottom: 2rem; }
  .mb-12 { margin-bottom: 2rem; }
  .p-8 { padding: 1.5rem; }
  .p-6 { padding: 1rem; }
}
`;

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);

  const navLinks = [
    { name: "Oncology Features", href: "#features" },
    { name: "Clinical Workflow", href: "#how-it-works" },
    { name: "Compliance", href: "#security" },
    { name: "About", href: "#about" },
  ];

  return (
    <>
      <style>{styles}</style>
      <nav className="fixed top-0 left-0 right-0 z-50 glass-card border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <a href="#" className="flex items-center gap-3 group">  
              <span className="text-lg md:text-xl text-foreground">
                Doctors <span className="gradient-text" style={{ fontWeight: 300 }}>Workstation</span>
              </span>
            </a>

            <div className="hidden md:flex items-center gap-8">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  className="text-muted-foreground hover:text-primary transition-colors duration-300 text-sm font-medium"
                >
                  {link.name}
                </a>
              ))}
            </div>

            <div className="hidden md:flex items-center gap-4">
              <a href="/clinic-login?ref=Onco-Webpage" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Sign In
              </a>
              <a href="#demo" className="btn-primary-glow text-sm text-primary-foreground">
                Request Demo
              </a>
            </div>

            <button
              onClick={() => setIsOpen(!isOpen)}
              className="md:hidden p-2 text-foreground"
            >
              {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

          {isOpen && (
            <div className="md:hidden mt-4 pb-4 border-t border-border pt-4 animate-fade-in-up">
              <div className="flex flex-col gap-4">
                {navLinks.map((link) => (
                  <a
                    key={link.name}
                    href={link.href}
                    onClick={() => setIsOpen(false)}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    {link.name}
                  </a>
                ))}
                <a href="#demo" className="btn-primary-glow text-center text-primary-foreground mt-2">
                  Request Demo
                </a>
              </div>
            </div>
          )}
        </div>
      </nav>
    </>
  );
};

const HeroSection = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      
      <style jsx>{`
        @media (max-width: 640px) {
          .hero-bg {
            background-position: calc(100% + 140px) center !important;
          }
        }
        @media (min-width: 641px) and (max-width: 1024px) {
          .hero-bg {
            background-position: calc(100% + 140px) center !important;
          }
        }
        @media (min-width: 1025px) {
          .hero-bg {
            background-position: center center !important;
          }
        }
      `}</style>

      <div
        className="absolute inset-0 hero-bg"
        style={{
          backgroundImage: `url(${bgImage})`,
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'calc(100% - 20px) center',
        }}
      />

      <div className="absolute inset-0 bg-black/60" />
      <div className="absolute inset-0 hero-gradient opacity-50" />
      <div className="absolute inset-0 animated-gradient opacity-20" />

      <div
        className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl"
        style={{
          animation: 'pulse-glow-orb 8s ease-in-out infinite, float-orb-1 25s ease-in-out infinite',
          willChange: 'transform',
        }}
      />
      <div
        className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent/10 rounded-full blur-3xl"
        style={{
          animation: 'pulse-glow-orb 10s ease-in-out infinite 1s, float-orb-2 30s ease-in-out infinite reverse',
          willChange: 'transform',
        }}
      />

      <div className="absolute inset-0 overflow-hidden">
        {Array.from({ length: 12 }).map((_, i) => {
          const size = 1 + Math.random() * 3;
          const duration = 15 + Math.random() * 25;
          const delay = Math.random() * 10;
          return (
            <div
              key={i}
              className="absolute rounded-full bg-primary/20"
              style={{
                width: `${size}px`,
                height: `${size}px`,
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animation: `float-particle ${duration}s ease-in-out infinite`,
                animationDelay: `${delay}s`,
                opacity: 0.15 + Math.random() * 0.2,
                willChange: 'transform',
              }}
            />
          );
        })}
      </div>

      <div
        className="absolute bottom-0 left-0 right-0 h-64 pointer-events-none z-5"
        style={{
          background: 'linear-gradient(to top, var(--background) 0%, rgba(0, 0, 0, 0.8) 20%, transparent 100%)',
        }}
      />

      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card mb-6"
            style={{
              animation: 'slide-up-fade 0.8s ease-out 0.2s both',
            }}
          >
            <span
              className="w-2 h-2 bg-primary rounded-full"
              style={{
                animation: 'pulse-dot 2s ease-in-out infinite',
              }}
            />
            <span className="text-xs sm:text-sm text-muted-foreground font-light">AI-Powered Oncology Platform • NCCN Guidelines Integrated</span>
          </div>

          <h1
            className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl leading-tight mb-6 font-light"
            style={{
              animation: 'fade-in-up 1s ease-out 0.4s both',
              fontWeight: 300,
            }}
          >
            Intelligent Decision Support{" "}
            <span className="gradient-text glow-text" style={{ fontWeight: 300 }}>
              for Complex Oncology Cases
            </span>
          </h1>

          <div
            className="h-[1px] bg-gradient-to-r from-transparent via-primary/30 to-transparent mx-auto mb-8 max-w-md"
            style={{
              animation: 'line-expand 1s ease-out 0.8s both',
              transform: 'scaleX(0)',
              transformOrigin: 'center',
            }}
          />

          <p
            className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed font-light"
            style={{
              animation: 'fade-in-bounce 1s ease-out 0.6s both',
              fontWeight: 300,
            }}
          >
            Transform unstructured clinical data into structured insights. AI-powered prognosis modeling, 
            automated documentation, and rule-based workflows with integrated communication and insurance modules.
          </p>

          <div
            className="flex flex-col sm:flex-row gap-4 justify-center"
            style={{
              animation: 'fade-in 0.8s ease-out 1s both',
            }}
          >
            <a
              href="#demo"
              className="btn-primary-glow flex items-center justify-center gap-2 text-primary-foreground relative overflow-hidden group"
              style={{
                transform: 'translateY(10px)',
                animation: 'button-enter 0.6s ease-out 1.1s forwards',
                opacity: 0,
              }}
            >
              <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              <span style={{ fontWeight: 400 }}>Request Demo</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-300" />
            </a>
            <a
              href="#how-it-works"
              className="btn-secondary-glow flex items-center justify-center gap-2 group relative"
              style={{
                transform: 'translateY(10px)',
                animation: 'button-enter 0.6s ease-out 1.2s forwards',
                opacity: 0,
              }}
            >
              <Play className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" />
              <span style={{ fontWeight: 400 }}>See Clinical Workflow</span>
            </a>
          </div>

          <div
            className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-8 max-w-2xl mx-auto"
            style={{
              opacity: 0,
              animation: 'fade-in 0.8s ease-out 1.3s forwards',
            }}
          >
            {[
              { value: "94%", label: "Diagnostic Accuracy", delay: 0 },
              { value: "2.5hrs", label: "Daily Documentation Time Saved", delay: 0.1 },
              { value: "15K+", label: "Oncology Cases Analyzed", delay: 0.2 },
            ].map((stat) => (
              <div
                key={stat.label}
                className="relative p-4 sm:p-6 rounded-2xl backdrop-blur-xl"
                style={{
                  transform: 'translateY(20px)',
                  animation: `card-enter 0.6s ease-out ${1.4 + stat.delay}s forwards`,
                  opacity: 0,
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
                }}
              >
                <div
                  className="absolute inset-0 rounded-2xl pointer-events-none"
                  style={{
                    background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.15), rgba(0, 210, 255, 0.08), rgba(0, 240, 255, 0.15))',
                    opacity: 0.5,
                    filter: 'blur(10px)',
                    zIndex: -1,
                  }}
                />

                <div
                  className="relative z-10"
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '1rem',
                    padding: '1rem sm:1.5rem',
                  }}
                >
                  <div
                    className="text-2xl sm:text-3xl gradient-text mb-1"
                    style={{ fontWeight: 300 }}
                  >
                    {stat.value}
                  </div>
                  <div className="text-xs text-muted-foreground font-light">{stat.label}</div>
                </div>

                <div
                  className="absolute top-0 left-0 right-0 h-[1px]"
                  style={{
                    background: 'linear-gradient(90deg, transparent, rgba(0, 240, 255, 0.3), transparent)',
                    opacity: 0.3,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

const TrustedBySection = () => {
  const useCases = [
    { icon: Building2, title: "Cancer Centers", description: "Comprehensive oncology workflow integration" },
    { icon: Microscope, title: "Pathology Labs", description: "Structured reporting from unstructured data" },
    { icon: Activity, title: "Clinical Trials", description: "Patient matching and eligibility screening" },
    { icon: Video, title: "Tumor Boards", description: "Multidisciplinary collaboration platform" },
  ];

  return (
    <section className="py-16 sm:py-24 relative overflow-hidden">
      <div className="absolute inset-0 section-gradient" />

      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="text-center mb-12 sm:mb-16">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-light mb-4 gradient-text" style={{ fontWeight: 300 }}>
            Built for Oncology Excellence
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto font-light" style={{ fontWeight: 300 }}>
            From community practices to NCI-designated cancer centers
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {useCases.map((useCase, index) => (
            <div
              key={useCase.title}
              className="glass-card-hover p-6 sm:p-8 rounded-2xl text-center group flex flex-col items-center"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6 group-hover:bg-primary/20 transition-colors">
                <useCase.icon className="w-8 h-8 text-primary icon-glow" />
              </div>

              <h3 className="text-xl font-semibold mb-2">{useCase.title}</h3>
              <p className="text-sm text-muted-foreground">{useCase.description}</p>
            </div>
          ))}
        </div>

        <div className="glow-line mt-16 sm:mt-24" />
      </div>
    </section>
  );
};

const ProblemSection = () => {
  const problems = [
    { icon: FileText, title: "Unstructured Data Overload", description: "Pathology reports, genomic data, and clinical notes scattered across systems - hard to process and synthesize for clinical decisions" },
    { icon: GitBranch, title: "Complex Decision Pathways", description: "Navigating NCCN, ASCO, and ESMO guidelines while considering patient-specific factors, comorbidities, and prognosis" },
    { icon: Clock3, title: "Documentation Burden", description: "Hours spent on manual documentation, tumor board preparation, and clinical notes instead of patient care" },
    { icon: MessageSquare, title: "Fragmented Communication", description: "Disconnected workflows between oncologists, pathologists, radiologists, and insurance providers delay critical decisions" },
  ];

  return (
    <section className="py-16 sm:py-24 relative overflow-hidden">
      <div className="absolute inset-0 section-gradient" />
      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="text-center mb-12 sm:mb-16">
          <span className="inline-block px-4 py-2 rounded-full glass-card text-sm text-primary mb-6 font-light" style={{ fontWeight: 300 }}>
            The Oncology Challenge
          </span>
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-light mb-6 gradient-text" style={{ fontWeight: 300 }}>
            Complex Data. Critical Decisions. Limited Time.
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto font-light" style={{ fontWeight: 300 }}>
            Every oncology case involves synthesizing unstructured data from multiple sources while following strict guidelines and considering prognosis.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {problems.map((problem, index) => (
            <div
              key={problem.title}
              className="glass-card p-6 rounded-2xl flex items-start gap-4 group hover:border-destructive/30 transition-all duration-500"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center group-hover:bg-destructive/20 transition-colors">
                <problem.icon className="w-6 h-6 text-destructive" />
              </div>
              <div>
                <h3 className="text-lg font-light mb-1" style={{ fontWeight: 300 }}>{problem.title}</h3>
                <p className="text-sm text-muted-foreground font-light" style={{ fontWeight: 300 }}>{problem.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const SolutionSection = () => {
  const features = [
    { icon: BrainCircuit, title: "Prognosis-Driven Decision Support", description: "AI models that analyze patient data against thousands of similar cases to provide prognosis-informed treatment recommendations aligned with NCCN, ASCO, and ESMO guidelines." },
    { icon: Dna, title: "Structured Data from Unstructured Sources", description: "Advanced NLP that extracts and structures critical information from pathology reports, genomic data, radiology notes, and clinical narratives - making the hard-to-process instantly actionable." },
    { icon: ClipboardList, title: "Intelligent Documentation & Workflows", description: "Rule-based automation that generates comprehensive clinical notes, tumor board summaries, prior authorization requests, and treatment plans following established oncology protocols." },
    { icon: MessageSquare, title: "Integrated Communication Hub", description: "Seamless coordination between oncologists, pathologists, radiologists, and care teams with automated updates, task assignments, and secure messaging." },
    { icon: FileSignature, title: "Insurance & Authorization Module", description: "Automated prior authorization workflows, medical necessity documentation with NCCN justification, and real-time insurance verification integrated into clinical workflow." },
    { icon: GitBranch, title: "Clinical Pathway Adherence", description: "Real-time validation against NCCN guidelines with automatic alerts for pathway deviations, alternative recommendations, and evidence-based treatment options." },
  ];

  return (
    <section id="features" className="py-16 sm:py-24 relative overflow-hidden">
      <div className="absolute inset-0 section-gradient" />

      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="text-center mb-12 sm:mb-16">
          <span className="inline-block px-4 py-2 rounded-full glass-card text-sm text-primary mb-6 font-light" style={{ fontWeight: 300 }}>
            The Oncology Solution
          </span>
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-light mb-6 gradient-text" style={{ fontWeight: 300 }}>
            AI That Understands the Complexity of Cancer Care
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto font-light" style={{ fontWeight: 300 }}>
            Transform unstructured data into structured insights. Make informed decisions with prognosis modeling. Automate workflows from documentation to insurance.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className="glass-card-hover p-6 sm:p-8 rounded-2xl group"
            >
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-6 group-hover:bg-primary/20 transition-all duration-300 group-hover:scale-110">
                <feature.icon className="w-7 h-7 text-primary icon-glow" />
              </div>
              <h3 className="text-xl font-light mb-3" style={{ fontWeight: 300 }}>{feature.title}</h3>
              <p className="text-muted-foreground leading-relaxed font-light" style={{ fontWeight: 300 }}>{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const HowItWorksSection = () => {
  const steps = [
    { icon: Microscope, step: "01", title: "Ingest Unstructured Data", description: "Connect to EHR, pathology, radiology, and genomic systems. Our AI extracts and structures critical information - including molecular markers, staging, and histopathology - automatically." },
    { icon: BrainCircuit, step: "02", title: "Prognosis & Pathway Analysis", description: "AI models analyze against NCCN guidelines and thousands of similar cases to provide prognosis-informed recommendations with survival curves and treatment response predictions." },
    { icon: ClipboardCheck, step: "03", title: "Rule-Based Workflow Generation", description: "Automated creation of treatment plans, clinical documentation, tumor board summaries, and task assignments based on clinical pathways and protocols." },
    { icon: FileSignature, step: "04", title: "Integrated Communication & Insurance", description: "Seamless coordination with care teams, automated prior authorization with medical necessity documentation, and real-time insurance verification." },
  ];

  return (
    <section id="how-it-works" className="py-16 sm:py-24 relative overflow-hidden">
      <div className="absolute inset-0 section-gradient" />
      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="text-center mb-12 sm:mb-16">
          <span className="inline-block px-4 py-2 rounded-full glass-card text-sm text-primary mb-6 font-light" style={{ fontWeight: 300 }}>
            Clinical Workflow
          </span>
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-light mb-6 gradient-text" style={{ fontWeight: 300 }}>
            From Unstructured Data to Actionable Insights
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto font-light" style={{ fontWeight: 300 }}>
            Streamlined oncology workflow that handles the complexity so you can focus on patient care
          </p>
        </div>

        <div className="relative">
          <div className="hidden lg:flex items-start justify-between">
            {steps.map((step, index) => (
              <div key={step.title} className="flex-1 flex flex-col items-center relative">
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
                  <step.icon className="w-8 h-8 text-primary icon-glow" />
                </div>

                <div className="glass-card-hover p-4 rounded-2xl text-center w-full max-w-sm mx-auto">
                  <div className="text-xs text-primary font-light mb-2" style={{ fontWeight: 300 }}>STEP {step.step}</div>
                  <h3 className="text-lg font-light mb-2" style={{ fontWeight: 300 }}>{step.title}</h3>
                  <p className="text-sm text-muted-foreground font-light" style={{ fontWeight: 300 }}>{step.description}</p>
                </div>

                {index < steps.length - 1 && (
                  <div
                    className="absolute top-8 left-[60%] right-[-40%] h-[2px]"
                    style={{
                      background: 'linear-gradient(90deg, var(--primary) 0%, transparent 100%)',
                      opacity: 0.3,
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="lg:hidden space-y-6">
            {steps.map((step, index) => (
              <div key={step.title} className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <step.icon className="w-7 h-7 text-primary icon-glow" />
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className="w-0.5 h-12 mx-auto mt-2"
                      style={{
                        background: 'linear-gradient(to bottom, var(--primary) 0%, transparent 100%)',
                        opacity: 0.5,
                      }}
                    />
                  )}
                </div>

                <div className="glass-card p-5 rounded-xl flex-1">
                  <div className="text-xs text-primary font-light mb-1" style={{ fontWeight: 300 }}>STEP {step.step}</div>
                  <h3 className="text-lg font-light mb-1" style={{ fontWeight: 300 }}>{step.title}</h3>
                  <p className="text-sm text-muted-foreground font-light" style={{ fontWeight: 300 }}>{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

const DashboardSection = () => {
  const stats = [
    { icon: Activity, label: "Active Oncology Cases", value: "847", change: "+12%" },
    { icon: TrendingUp, label: "Treatment Plans Generated", value: "156", change: "+23%" },
    { icon: Users, label: "Tumor Board Reviews", value: "48", change: "This Week" },
    { icon: Clock, label: "Auth Processing Time", value: "4.2hrs", change: "-62%" },
  ];

  return (
    <section className="py-16 sm:py-24 relative overflow-hidden">
      <div className="absolute inset-0 section-gradient" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-primary/3 rounded-full blur-3xl" style={{ willChange: 'filter' }} />

      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="text-center mb-12 sm:mb-16">
          <span className="inline-block px-4 py-2 rounded-full glass-card text-sm text-primary mb-6 font-light" style={{ fontWeight: 300 }}>
            Oncology Dashboard
          </span>
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-light mb-6 gradient-text" style={{ fontWeight: 300 }}>
            Complete Case Overview
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto font-light" style={{ fontWeight: 300 }}>
            Unified view of patient data, treatment pathways, and workflow status
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
          {stats.map((stat) => (
            <div key={stat.label} className="glass-card-hover p-6 rounded-2xl group">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <stat.icon className="w-6 h-6 text-primary icon-glow" />
                </div>
                <span className="text-xs text-primary font-light" style={{ fontWeight: 300 }}>{stat.change}</span>
              </div>
              <div className="text-2xl sm:text-3xl font-light mb-1" style={{ fontWeight: 300 }}>{stat.value}</div>
              <div className="text-sm text-muted-foreground font-light" style={{ fontWeight: 300 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const BenefitsSection = () => {
  const benefits = [
    { icon: Zap, title: "Unstructured Data Processing", stat: "85%", description: "Reduction in time spent manually extracting data from pathology and radiology reports" },
    { icon: Brain, title: "Prognosis Accuracy", stat: "94%", description: "Alignment with tumor board decisions using AI-assisted analysis of complex cases" },
    { icon: Heart, title: "Treatment Pathway Adherence", stat: "98%", description: "NCCN guideline compliance with automated validation and alerts" },
    { icon: FileSignature, title: "Insurance Approval Rate", stat: "76%", description: "Improvement in first-pass prior authorization approvals with automated documentation" },
    { icon: Clock3, title: "Documentation Time Saved", stat: "3.5hrs", description: "Daily reduction in clinical documentation and tumor board preparation time" },
  ];

  return (
    <section id="about" className="py-16 sm:py-24 relative overflow-hidden">
      <div className="absolute inset-0 section-gradient" />
      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="text-center mb-12 sm:mb-16">
          <span className="inline-block px-4 py-2 rounded-full glass-card text-sm text-primary mb-6 font-light" style={{ fontWeight: 300 }}>
            Measurable Impact
          </span>
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-light mb-6 gradient-text" style={{ fontWeight: 300 }}>
            Transforming Oncology Practice
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto font-light" style={{ fontWeight: 300 }}>
            Real results from cancer centers already using our platform
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
          {benefits.map((benefit) => (
            <div key={benefit.title} className="glass-card-hover p-6 rounded-2xl text-center group">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-4 mx-auto group-hover:bg-primary/20 transition-colors">
                <benefit.icon className="w-6 h-6 text-primary icon-glow" />
              </div>

              <div className="text-2xl sm:text-3xl font-light gradient-text mb-2" style={{ fontWeight: 300 }}>{benefit.stat}</div>

              <h3 className="text-sm font-light mb-2" style={{ fontWeight: 300 }}>{benefit.title}</h3>
              <p className="text-xs text-muted-foreground font-light" style={{ fontWeight: 300 }}>{benefit.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const SecuritySection = () => {
  const securityFeatures = [
    { icon: Lock, title: "HIPAA Compliant", description: "Enterprise-grade security with encryption for all protected health information" },
    { icon: ShieldCheck, title: "Oncology-Specific Audit", description: "Detailed tracking for clinical trials, regulatory requirements, and compliance reporting" },
    { icon: FileCheck, title: "NCCN Guidelines Integration", description: "Validated clinical pathways with version control and real-time updates" },
    { icon: Server, title: "FHIR & HL7 Integration", description: "Seamless connectivity with oncology EHR systems and laboratory information systems" },
  ];

  return (
    <section id="security" className="py-16 sm:py-24 relative overflow-hidden">
      <div className="absolute inset-0 section-gradient" />

      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <span className="inline-block px-4 py-2 rounded-full glass-card text-sm text-primary mb-6 font-light" style={{ fontWeight: 300 }}>
              Compliance & Security
            </span>
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-light mb-6 gradient-text" style={{ fontWeight: 300 }}>
              Built for Oncology Compliance
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground mb-8 font-light" style={{ fontWeight: 300 }}>
              Your patients' data and treatment decisions deserve the highest level of protection and guideline alignment. We've built our platform from the ground up with oncology-specific compliance as the foundation.
            </p>

            <div className="flex flex-wrap gap-4">
              {["HIPAA", "NCCN", "ASCO", "ESMO", "FDA"].map((badge) => (
                <div key={badge} className="glass-card px-4 py-2 rounded-lg flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  <span className="text-sm font-light" style={{ fontWeight: 300 }}>{badge}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {securityFeatures.map((feature) => (
              <div key={feature.title} className="glass-card-hover p-6 rounded-2xl group">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-4 group-hover:bg-primary/20 transition-colors">
                  <feature.icon className="w-6 h-6 text-primary icon-glow" />
                </div>
                <h3 className="text-lg font-light mb-2" style={{ fontWeight: 300 }}>{feature.title}</h3>
                <p className="text-sm text-muted-foreground font-light" style={{ fontWeight: 300 }}>{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

const ProductsSection = () => {
  const products = [
    {
      name: "Oncology Space",
      icon: ScanHeart,
      description: "Smart assistance for community oncology practices",
      features: [
        "Automated extraction from pathology and radiology reports",
        "NCCN guideline-based treatment recommendations",
        "Streamlined prior authorization workflows",
        "Integrated tumor board preparation tools"
      ]
    },
    {
      name: "Oncology Workstation",
      icon: BrainCircuit,
      description: "Enterprise-grade AI for cancer centers and research institutions",
      features: [
        "Advanced prognosis modeling with survival analytics",
        "Clinical trial matching and eligibility screening",
        "Multi-disciplinary care coordination hub",
        "Real-time insurance verification and claims processing"
      ]
    }
  ];

  return (
    <section className="py-16 sm:py-24 relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 bg-black">
        <div className="absolute inset-0 hero-gradient opacity-30" />
        <div className="absolute inset-0 animated-gradient opacity-10" />

        <div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl"
          style={{
            animation: 'pulse-glow-orb 8s ease-in-out infinite, float-orb-1 25s ease-in-out infinite',
            willChange: 'transform',
          }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent/10 rounded-full blur-3xl"
          style={{
            animation: 'pulse-glow-orb 10s ease-in-out infinite 1s, float-orb-2 30s ease-in-out infinite reverse',
            willChange: 'transform',
          }}
        />

        <div className="absolute inset-0 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => {
            const size = 1 + Math.random() * 2;
            const duration = 15 + Math.random() * 25;
            const delay = Math.random() * 10;
            return (
              <div
                key={i}
                className="absolute rounded-full bg-primary/20"
                style={{
                  width: `${size}px`,
                  height: `${size}px`,
                  left: `${Math.random() * 100}%`,
                  top: `${Math.random() * 100}%`,
                  animation: `float-particle ${duration}s ease-in-out infinite`,
                  animationDelay: `${delay}s`,
                  opacity: 0.1,
                  willChange: 'transform',
                }}
              />
            );
          })}
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="text-center mb-12 sm:mb-16">
          <span
            className="inline-block px-4 py-2 rounded-full text-sm mb-6 font-light"
            style={{
              fontWeight: 300,
              background: 'rgba(255, 255, 255, 0.03)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
              color: '#00f0ff'
            }}
          >
            Our Oncology Solutions
          </span>
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-light mb-6 gradient-text" style={{ fontWeight: 300 }}>
            Choose Your Oncology Platform
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto font-light" style={{ fontWeight: 300 }}>
            Purpose-built tools for modern cancer care, from community practices to academic medical centers
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 max-w-6xl mx-auto">
          {products.map((product) => (
            <div
              key={product.name}
              className="p-6 sm:p-8 rounded-2xl relative group transition-all duration-500 glass-card-hover flex flex-col h-full"
              style={{
                backdropFilter: 'blur(15px)',
                WebkitBackdropFilter: 'blur(15px)',
                border: '1px solid rgba(255, 255, 255, 0.19)',
                background: 'rgba(255, 255, 255, 0.03)',
              }}
            >
              <div
                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{
                  background: 'radial-gradient(circle at 50% 50%, rgba(0, 240, 255, 0.15) 0%, transparent 70%)',
                }}
              />

              <div className="flex items-center gap-4 mb-6 sm:mb-8 relative z-10">
                <div
                  className="w-14 h-14 sm:w-16 sm:h-16 p-3 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: 'rgba(0, 240, 255, 0.1)',
                    border: '1px solid rgba(0, 240, 255, 0.2)',
                    boxShadow: '0 0 20px rgba(0, 240, 255, 0.1)'
                  }}
                >
                  <product.icon className="w-8 h-8 sm:w-10 sm:h-10 text-primary icon-glow" />
                </div>
                <div>
                  <h3 className="text-xl sm:text-2xl font-light text-white" style={{ fontWeight: 300 }}>{product.name}</h3>
                  <p className="text-primary text-sm sm:text-base mt-1 font-light" style={{ color: '#00f0ff', fontWeight: 300 }}>{product.description}</p>
                </div>
              </div>

              <p className="text-muted-foreground mb-6 sm:mb-8 leading-relaxed relative z-10 font-light text-sm sm:text-base" style={{ fontWeight: 300 }}>
                {product.name === "Oncology Space"
                  ? "Smart assistance for community oncology practices and outpatient cancer care"
                  : "From community cancer centers to NCI-designated comprehensive cancer centers, scales with your needs"}
              </p>

              <div className="mb-8 sm:mb-10 relative z-10 flex-grow">
                <h4 className="text-xs sm:text-sm font-light text-white mb-4 tracking-wider uppercase" style={{ fontWeight: 300 }}>Key Features:</h4>
                <div className="space-y-3 sm:space-y-4">
                  {product.features.map((feature, index) => (
                    <div key={index} className="flex items-start gap-3 group/feature">
                      <div
                        className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 rounded-lg flex items-center justify-center mt-0.5"
                        style={{
                          background: 'linear-gradient(135deg, #00f0ff, #00d2ff)',
                          boxShadow: '0 0 10px rgba(0, 240, 255, 0.3)'
                        }}
                      >
                        <span className="text-black text-xs sm:text-sm font-light" style={{ fontWeight: 300 }}>✓</span>
                      </div>
                      <span className="text-muted-foreground group-hover/feature:text-white transition-colors duration-300 font-light text-sm sm:text-base" style={{ fontWeight: 300 }}>
                        {feature}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Button container with consistent margin and positioning */}
              <div className="relative z-10 mt-auto pt-4">
                <a
                  href="/clinic-login?ref=Onco-Webpage"
                  className="relative w-full flex items-center justify-center gap-2 text-primary-foreground transition-all duration-300 rounded-lg py-3 px-6 group/btn overflow-hidden"
                  style={{
                    background: '#00f0ff',
                    boxShadow: '0 0 20px rgba(0, 240, 255, 0.3)',
                    color: '#000000',
                    fontWeight: 300,
                    willChange: 'transform, box-shadow',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = '0 0 30px rgba(0, 240, 255, 0.5)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 240, 255, 0.3)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <span className="relative z-10">Get Started</span>
                  <ArrowRight className="w-5 h-5 relative z-10 group-hover/btn:translate-x-1 transition-transform duration-300" />
                  <div
                    className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-700"
                    style={{
                      background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent)'
                    }}
                  />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="absolute bottom-0 left-0 right-0 h-64 pointer-events-none z-5"
        style={{
          background: 'linear-gradient(to top, var(--background) 0%, rgba(0, 0, 0, 0.8) 20%, transparent 100%)',
        }}
      />
    </section>
  );
};

const CTASection = () => {
  return (
    <section id="demo" className="py-16 sm:py-24 relative overflow-hidden">
      <div className="absolute inset-0 hero-gradient opacity-50" />
      

      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          <div className="glass-card p-8 sm:p-12 md:p-16 rounded-3xl dashboard-glow">
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-light mb-6 gradient-text" style={{ fontWeight: 300 }}>
              Transform Your Oncology Practice With AI
            </h2>

            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto mb-8 sm:mb-10 font-light" style={{ fontWeight: 300 }}>
              Join the cancer centers already using Doctors Workstation to improve treatment decisions, reduce documentation burden, and streamline insurance workflows.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a href="/clinic-login?ref=Onco-Webpage" className="btn-primary-glow flex items-center justify-center gap-2 text-primary-foreground">
                Get Started
                <ArrowRight className="w-5 h-5" />
              </a>
              <a href="/clinic-login?ref=Onco-Webpage" className="btn-secondary-glow flex items-center justify-center gap-2">
                <Calendar className="w-5 h-5" />
                Schedule Oncology Demo
              </a>
            </div>

            <p className="text-xs sm:text-sm text-muted-foreground mt-8 font-light" style={{ fontWeight: 300 }}>
              Free pilot program for cancer centers • No credit card required • Deploy in 48 hours • NCCN guidelines included
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

const Footer = () => {
  const footerLinks = {
    "Oncology Solutions": ["Oncology Space", "Doctors Workstation", "Tumor Board", "Clinical Trials"],
    "Clinical Resources": ["NCCN Guidelines", "ASCO Resources", "ESMO Guidelines", "Drug Compendia"],
    "Company": ["About", "Careers", "Press", "Contact"],
    "Legal & Compliance": ["Privacy", "HIPAA", "Terms", "Compliance"],
  };

  // Map specific links to their corresponding sections
  const linkToSection = {
    "Oncology Space": "#features",
    "Doctors Workstation": "#features",
    "Tumor Board": "#how-it-works",
    "Clinical Trials": "#about",
    "NCCN Guidelines": "#security",
    "ASCO Resources": "#security",
    "ESMO Guidelines": "#security",
    "Drug Compendia": "#features",
    "About": "#about",
    "Careers": "#about",
    "Press": "#about",
    "Contact": "#demo",
    "Privacy": "#security",
    "HIPAA": "#security",
    "Terms": "#security",
    "Compliance": "#security",
  };

  const handleClick = (e, item) => {
    e.preventDefault();
    const sectionId = linkToSection[item] || "#";
    const element = document.querySelector(sectionId);
    if (element) {
      const offset = 80; // Offset for fixed navbar
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;
      
      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth"
      });
    }
  };

  return (
    <footer className="sticky bottom-0 py-12 sm:py-16 relative border-t border-border/30 overflow-hidden backdrop-blur-3xl bg-black/50 z-40">
      <style>{`
        @keyframes float-footer-link {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
        }

        .footer-glass {
          background: linear-gradient(135deg, rgba(0, 240, 255, 0.05) 0%, rgba(0, 210, 255, 0.02) 100%);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(0, 240, 255, 0.1);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2);
        }

        .footer-orb {
          position: absolute;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, rgba(0, 240, 255, 0.15), rgba(0, 240, 255, 0.02));
          filter: blur(60px);
          animation: pulse-glow 8s ease-in-out infinite;
          will-change: transform;
        }

        .footer-link-hover:hover {
          animation: float-footer-link 1.5s ease-in-out infinite;
        }

        .footer-grid-overlay {
          position: absolute;
          inset: 0;
          overflow: hidden;
          opacity: 0.1;
          pointer-events: none;
        }
      `}</style>

      <div className="absolute inset-0 footer-glass pointer-events-none" />

      <div className="footer-grid-overlay">
        {Array.from({ length: 3 }).map((_, i) => {
          const delay = Math.random() * 6;
          const duration = 10 + Math.random() * 6;
          const pos = Math.random() * 100;

          return (
            <div
              key={`h-${i}`}
              style={{
                position: 'absolute',
                left: 0,
                top: `${pos}%`,
                width: '100%',
                height: '40px',
                background: `linear-gradient(90deg, transparent, rgba(0, 240, 255, 0.3), transparent)`,
                borderTop: '1px solid rgba(0, 240, 255, 0.2)',
                borderBottom: '1px solid rgba(0, 240, 255, 0.2)',
                boxShadow: '0 0 15px rgba(0, 240, 255, 0.15)',
                animation: `grid-move-horizontal ${duration}s linear infinite`,
                animationDelay: `${delay}s`,
                willChange: 'transform, opacity',
                transform: 'translate3d(0, 0, 0)',
              }}
            />
          );
        })}

        {Array.from({ length: 2 }).map((_, i) => {
          const delay = Math.random() * 6;
          const duration = 12 + Math.random() * 6;
          const pos = Math.random() * 100;

          return (
            <div
              key={`v-${i}`}
              style={{
                position: 'absolute',
                top: 0,
                left: `${pos}%`,
                width: '40px',
                height: '100%',
                background: `linear-gradient(180deg, transparent, rgba(0, 240, 255, 0.3), transparent)`,
                borderLeft: '1px solid rgba(0, 240, 255, 0.2)',
                borderRight: '1px solid rgba(0, 240, 255, 0.2)',
                boxShadow: '0 0 15px rgba(0, 240, 255, 0.15)',
                animation: `grid-move-vertical ${duration}s linear infinite`,
                animationDelay: `${delay}s`,
                willChange: 'transform, opacity',
                transform: 'translate3d(0, 0, 0)',
              }}
            />
          );
        })}
      </div>

      <div className="absolute top-0 left-1/3 w-96 h-96 footer-orb" style={{ animation: 'pulse-glow 8s ease-in-out infinite' }} />
      <div className="absolute bottom-1/4 right-1/3 w-80 h-80 footer-orb" style={{ animation: 'pulse-glow 10s ease-in-out infinite 1s' }} />

      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 sm:gap-12 mb-12">
          <div className="col-span-2 md:col-span-3 lg:col-span-2">
            <a href="#" className="flex items-center gap-3 mb-4 group" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              <span className="text-lg sm:text-xl text-white group-hover:text-primary transition-colors duration-300 footer-link-hover">
                Doctors <span className="gradient-text" style={{ fontWeight: 300 }}>Workstation</span>
              </span>
            </a>
            <p className="text-muted-foreground text-sm max-w-xs mb-6 leading-relaxed font-light" style={{ fontWeight: 300 }}>
              AI-powered clinical decision support that helps oncologists deliver better patient care through intelligent data processing and guideline-based recommendations.
            </p>
            <div className="flex gap-4">
              {["LinkedIn", "Twitter", "YouTube"].map((social) => (
                <a
                  key={social}
                  href="#"
                  className="text-muted-foreground hover:text-primary transition-all duration-300 text-sm footer-link-hover"
                  onClick={(e) => e.preventDefault()}
                >
                  {social}
                </a>
              ))}
            </div>
          </div>

          {Object.entries(footerLinks).map(([category, items]) => (
            <div key={category}>
              <h4 className="font-semibold text-white mb-4 text-sm sm:text-base">{category}</h4>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item}>
                    <a
                      href={linkToSection[item] || "#"}
                      className="text-xs sm:text-sm text-muted-foreground hover:text-primary transition-all duration-300 group inline-flex items-center gap-2 footer-link-hover cursor-pointer"
                      onClick={(e) => handleClick(e, item)}
                    >
                      <span>{item}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="glow-line mb-8 opacity-30" />

        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs sm:text-sm text-muted-foreground text-center md:text-left hover:text-primary transition-colors duration-300 font-light" style={{ fontWeight: 300 }}>
            © 2026 Oncology Workstation. All rights reserved. NCCN, ASCO, and ESMO guidelines integrated.
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground text-center md:text-right hover:text-primary transition-colors duration-300 font-light" style={{ fontWeight: 300 }}>
            Advancing cancer care through intelligent technology
          </p>
        </div>
      </div>
    </footer>
  );
};
const WebpageOnco = () => {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden pb-20" style={{ scrollBehavior: 'smooth' }}>
      <Navbar />
      <HeroSection />
      <TrustedBySection />
      <ProblemSection />
      <SolutionSection />
      <HowItWorksSection />
      <DashboardSection />
      <BenefitsSection />
      <SecuritySection />
      <ProductsSection />
      <CTASection />
      <Footer />
    </div>
  );
};

export default WebpageOnco;