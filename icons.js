// Tiny, local, dependency-free outline icons. Works when Google Fonts is blocked.
(() => {
  const ICONS = {
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
    search:'<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
    inbox:'<path d="M4 4h16l2 10v6H2v-6L4 4Z"/><path d="M2 14h6l2 3h4l2-3h6"/>',
    send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2"/>',
    group:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2H3ZM17 5a3 3 0 0 1 0 6m2 5a5 5 0 0 1 2 4"/>',
    diversity_3:'<circle cx="12" cy="7" r="3"/><circle cx="4.5" cy="11" r="2"/><circle cx="19.5" cy="11" r="2"/><path d="M7 21v-2a5 5 0 0 1 10 0v2H7ZM1 21v-3a3 3 0 0 1 3-3m19 6v-3a3 3 0 0 0-3-3"/>',
    dark_mode:'<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
    light_mode:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    logout:'<path d="M9 4H4v16h5M15 8l4 4-4 4m4-4H9"/>',
    edit:'<path d="m5 16-1 4 4-1L20 7l-3-3L5 16ZM14.5 6.5l3 3"/>',
    close:'<path d="M5 5l14 14M19 5 5 19"/>',
    refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 12-2L20 12M4 12l2.5 5a7 7 0 0 0 12-2"/>',
    delete:'<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    reply:'<path d="m10 7-6 5 6 5v-4c7 0 9 2 10 6-.1-7-3-11-10-11V7Z"/>',
    fullscreen:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    fullscreen_exit:'<path d="M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5"/>',
    format_bold:'<path d="M7 4h6a4 4 0 0 1 0 8H7m0-8v16h7a4 4 0 0 0 0-8H7"/>',
    format_italic:'<path d="M15 4H9m6 16H9M14 4l-4 16"/>',
    format_underlined:'<path d="M7 4v7a5 5 0 0 0 10 0V4M5 21h14"/>',
    format_list_bulleted:'<circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/><path d="M9 6h12M9 12h12M9 18h12"/>',
    link:'<path d="M10 13a5 5 0 0 0 7 .3l3-3a5 5 0 1 0-7-7l-2 2M14 11a5 5 0 0 0-7-.3l-3 3a5 5 0 1 0 7 7l2-2"/>',
    auto_awesome:'<path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2ZM20 17l.6 2.4L23 20l-2.4.6L20 23l-.6-2.4L17 20l2.4-.6L20 17Z"/>',
    favorite:'<path d="M20.8 5.8a5.5 5.5 0 0 0-7.8 0L12 7l-1.1-1.2a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z"/>',
    mark_email_unread:'<rect x="2" y="6" width="17" height="14" rx="2"/><path d="m2 8 9 6 5-3"/><circle cx="20" cy="5" r="3"/>',
    schedule_send:'<path d="m3 5 17 6-8 3-2 7-7-16ZM10 13 20 11"/><circle cx="19" cy="18" r="4"/><path d="M19 16v2h2"/>',
    person_add:'<circle cx="9" cy="8" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M19 9v8m-4-4h8"/>',
    add_photo_alternate:'<rect x="3" y="4" width="17" height="16" rx="2"/><circle cx="8" cy="9" r="2"/><path d="m4 18 5-5 4 4 3-3 3 3M21 4v6m-3-3h6"/>',
    sync:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 9a7 7 0 0 1 12-2M18 15a7 7 0 0 1-12 2"/>',
    shield_lock:'<path d="M12 2 4 5v6c0 5 3 9 8 11 5-2 8-6 8-11V5L12 2Z"/><rect x="9" y="11" width="6" height="5" rx="1"/><path d="M10 11V9a2 2 0 0 1 4 0v2"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'
  };
  function paint() {
    for (const el of document.querySelectorAll('.material-symbols-outlined:not([data-icon-ready])')) {
      const icon=ICONS[el.textContent.trim()];
      el.dataset.iconReady='1';
      if (icon) el.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon}</svg>`;
    }
  }
  paint();new MutationObserver(paint).observe(document.body,{subtree:true,childList:true});
})();
