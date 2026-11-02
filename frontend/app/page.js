"use client";

import Script from "next/script";

export default function HomePage() {
  return (
    <>
      <div className="app-shell" data-api-base-url={process.env.NEXT_PUBLIC_API_URL || ""}>
        <aside className="sidebar" id="sidebar">
          <a className="brand" href="#payment-lookup" aria-label="Gun-ob PWD Registry home">
            <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 3.5 27 8v7.4c0 6.4-4.4 10.9-11 13.1C9.4 26.3 5 21.8 5 15.4V8l11-4.5Z"/><path d="M16 10v12M10 16h12"/></svg></span>
            <span className="brand-copy"><strong>Gun-ob</strong><small>PWD Registry</small></span>
          </a>
          <div className="sidebar-label" id="workspaceLabel" hidden>WORKSPACE</div>
          <nav className="primary-nav admin-navigation" id="adminNavigation" aria-label="Admin navigation" hidden>
            <button className="nav-link active" data-view="overview"><span className="nav-icon">▦</span>Overview</button>
            <button className="nav-link" data-view="members"><span className="nav-icon">♙</span>Members</button>
            <button className="nav-link" data-view="payments"><span className="nav-icon">₱</span>Payments</button>
            <button className="nav-link" data-view="income"><span className="nav-icon">↗</span>Income log</button>
            <button className="nav-link" data-view="activity"><span className="nav-icon">◷</span>Activity log</button>
          </nav>
          <div className="sidebar-label public-label" id="publicNavigationLabel">PUBLIC ACCESS</div>
          <nav className="primary-nav" id="publicNavigation" aria-label="Public navigation">
            <button className="nav-link active" data-view="public"><span className="nav-icon">⌕</span>Payment history</button>
          </nav>
          <div className="sidebar-spacer" />
          <div className="sidebar-note"><span className="note-dot" /><div><strong>Gun-ob, Lapu-Lapu City</strong><small>Persons with Disabilities</small></div></div>
          <button className="mobile-close" id="closeSidebar" aria-label="Close navigation">×</button>
        </aside>

        <div className="main-column">
          <header className="topbar">
            <button className="menu-toggle" id="menuToggle" aria-label="Open navigation"><span /><span /><span /></button>
            <div className="breadcrumb"><span>Gun-ob PWD Registry</span><span className="crumb-slash">/</span><strong id="pageTitle">Payment history</strong></div>
            <div className="topbar-right"><span className="year-chip" id="yearChip" hidden /><span className="duty-label" id="dutyLabel" hidden>No duty selected</span><button className="button button-text duty-change" id="changeDuty" type="button" data-action="change-duty" hidden>Change</button><button className="button button-secondary auth-action" id="authAction" type="button" data-action="login">Admin login</button></div>
          </header>
          <main id="mainContent" tabIndex="-1" />
          <footer className="page-footer"><span>Barangay Gun-ob · Persons with Disabilities Affairs</span><span>Registry workspace</span></footer>
        </div>
      </div>
      <div className="modal-backdrop" id="modalBackdrop" hidden />
      <Script src="/app.js" strategy="afterInteractive" />
    </>
  );
}