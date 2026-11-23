window.__ModuleLoader__.load({
  id: 'dsh-acp-hub',
  factory(require) {
    const React = require('react')
    let ReactDOM = null
    try {
      ReactDOM = require('react-dom')
    } catch {}
    const h = React.createElement

    let runtimeCtx = null
    let slotRegistrar = null
    const registeredToolViews = new Set()

    const PANEL_ID = 'acp-hub-settings'
    const NS = 'acpHub'
    const API_STATE = '/api/acp-hub.state'
    const API_SESSION = '/api/acp-hub.session'
    const API_FOLLOWUP = '/api/acp-hub.followup'
    const API_OPEN_SOURCE = '/api/acp-hub.open-source'
    const API_PRESETS = '/api/acp-hub.presets'
    const API_CATALOG = '/api/acp-hub.catalog'
    const API_INSPECT = '/api/acp-hub.inspect'
    const API_SAVE_SETTINGS = '/api/acp-hub.save-settings'
    const API_SAVE_AGENT = '/api/acp-hub.save-agent'
    const API_TOGGLE_AGENT = '/api/acp-hub.toggle-agent'
    const API_REMOVE_AGENT = '/api/acp-hub.remove-agent'
    const API_CANCEL = '/api/acp-hub.cancel'

    const PRESET_KEYS = [
      'delegate_acp',
      'zcode',
      'minimax',
      'codebuddy',
      'opencode',
      'codex',
      'claude',
      'qoder',
      'gemini',
    ]

    const AGENT_ID_RE = /^[a-z][a-z0-9-]{1,31}$/

    const STYLES = [
      /* Master-detail shell */
      '.acpHubPage{display:flex;box-sizing:border-box;width:100%;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:20px}',
      '.acpHubRail{display:flex;flex-direction:column;box-sizing:border-box;flex:0 0 296px;width:296px;min-width:0;min-height:0;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1))}',
      '.acpHubRailHead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 14px 10px}',
      '.acpHubRailTitleWrap{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.acpHubRailTitle{margin:0;font-size:14px;line-height:20px;font-weight:650}',
      '.acpHubRailSub{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
      '.acpHubSearchWrap{padding:0 12px 10px}',
      '.acpHubSearch{box-sizing:border-box;width:100%;height:32px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;transition:border-color .14s,box-shadow .14s}',
      '.acpHubSearch:focus{outline:none;border-color:var(--dsw-static-deepseek-500, #4176e6);box-shadow:0 0 0 2px rgba(65,118,230,.14)}',
      '.acpHubList{display:flex;flex-direction:column;gap:3px;flex:1;min-height:0;overflow:auto;padding:0 10px 14px}',
      '.acpHubRow{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;cursor:pointer;transition:background .12s}',
      '.acpHubRow:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.acpHubRowActive{background:var(--dsw-specific-sidebar-nav-item-active, var(--dsw-alias-interactive-bg-active))}',
      '.acpHubRowActive:hover{background:var(--dsw-specific-sidebar-nav-item-active, var(--dsw-alias-interactive-bg-active))}',
      '.acpHubRowOff{opacity:.58}',

      /* Frameless full-bleed ACP icons (zero border, zero background box, fixed dimensions) */
      '.acpHubAvatar{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:none;background:transparent;overflow:visible}',
      '.acpHubAvatarLg{width:34px;height:34px}',
      '.acpHubAvatar img{display:block;width:100%;height:100%;object-fit:contain}',

      '.acpHubRowBody{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}',
      '.acpHubRowTop{display:flex;align-items:center;gap:6px;min-width:0}',
      '.acpHubRowName{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.acpHubRowId{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))}',
      '.acpHubRowMeta{display:flex;align-items:center;gap:5px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.acpHubDot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary, #10b981)}',
      '.acpHubDotMuted{background:var(--dsw-alias-state-idle-primary, #9ca3af)}',
      '.acpHubDotWarn{background:var(--dsw-alias-state-error-primary, #ef4444)}',

      /* Detail workspace */
      '.acpHubMain{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:var(--dsw-alias-bg-base)}',
      '.acpHubHero{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 24px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);flex-wrap:wrap}',
      '.acpHubHeroLeft{display:flex;align-items:center;gap:12px;min-width:0}',
      '.acpHubHeroTitleRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.acpHubHeroTitle{margin:0;font-size:16px;line-height:22px;font-weight:650}',
      '.acpHubHeroPills{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px}',
      '.acpHubHeroActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.acpHubTabs{display:flex;align-items:center;gap:4px;padding:0 24px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}',
      '.acpHubTab{position:relative;padding:9px 12px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .12s}',
      '.acpHubTab:hover{color:var(--dsw-alias-label-primary)}',
      '.acpHubTabActive{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-static-deepseek-500, var(--dsw-alias-brand-primary))}',
      '.acpHubTabBadge{display:inline-flex;align-items:center;justify-content:center;margin-left:5px;padding:0 6px;border-radius:999px;font-size:10.5px;line-height:16px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}',
      '.acpHubBody{flex:1;min-height:0;overflow:auto;padding:20px 24px 36px}',
      '.acpHubContainer{max-width:880px}',
      '.acpHubContainerWide{max-width:1280px}',

      /* Controls & primitives */
      '.acpHubBtn{display:inline-flex;align-items:center;justify-content:center;gap:5px;box-sizing:border-box;height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;text-decoration:none;transition:background .12s,border-color .12s}',
      '.acpHubBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3, var(--dsw-alias-border-l2))}',
      '.acpHubBtn:disabled{opacity:.48;cursor:default}',
      '.acpHubBtnSm{height:26px;padding:0 9px;font-size:11.5px;border-radius:7px}',
      '.acpHubBtnXs{height:22px;padding:0 7px;font-size:11px;border-radius:6px}',
      '.acpHubBtnPrimary{background:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary));border-color:transparent;color:var(--dsw-alias-label-primary-inverted, #fff);font-weight:600}',
      '.acpHubBtnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary));border-color:transparent;opacity:.92}',
      '.acpHubBtnDanger{color:var(--dsw-alias-state-error-primary, #ef4444);border-color:var(--dsw-alias-state-error-primary, #ef4444)}',
      '.acpHubPill{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;font-size:11px;line-height:16px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1)}',
      '.acpHubPillMono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px}',
      '.acpHubPillOk{color:var(--dsw-alias-state-success-primary, #10b981);background:var(--dsw-static-green-500-a08, rgba(34,197,94,.08));border-color:transparent}',
      '.acpHubPillBrand{color:var(--dsw-alias-state-business-primary, #4176e6);background:rgba(65,118,230,.1);border-color:transparent}',
      '.acpHubPillErr{color:var(--dsw-alias-state-error-primary, #ef4444);background:var(--dsw-static-red-600-a08, rgba(236,19,19,.08));border-color:transparent}',
      '.acpHubSwitch{position:relative;display:inline-flex;flex:none;align-items:center;width:32px;height:18px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-module-platform);cursor:pointer;transition:background .14s,border-color .14s}',
      '.acpHubSwitchOn{background:var(--dsw-static-deepseek-500, #4176e6);border-color:var(--dsw-static-deepseek-500, #4176e6)}',
      '.acpHubKnob{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.18);transition:transform .14s}',
      '.acpHubSwitchOn .acpHubKnob{transform:translateX(14px)}',

      /* Custom Modern Popover Select (`HubSelect` + 2-Column Cascading Flyout) */
      '.acpSelWrap{position:relative;display:flex;width:100%;min-width:0}',
      '.acpSelTrigger{display:flex;align-items:center;justify-content:space-between;gap:8px;box-sizing:border-box;width:100%;min-height:36px;padding:5px 10px 5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:20px;text-align:left;cursor:pointer;transition:background .12s,border-color .12s,box-shadow .12s}',
      '.acpSelTrigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3, var(--dsw-alias-border-l2))}',
      '.acpSelTriggerOpen,.acpSelTrigger:focus-visible{outline:none;border-color:var(--dsw-static-deepseek-500, #4176e6);box-shadow:0 0 0 2px rgba(65,118,230,.15);background:var(--dsw-alias-bg-base)}',
      '.acpSelTrigger:disabled{opacity:.55;cursor:default}',
      '.acpSelTriggerCompact{min-height:28px;padding:2px 8px 2px 10px;font-size:11.5px;border-radius:7px}',
      '.acpSelValWrap{display:flex;align-items:center;gap:6px;min-width:0;flex:1;overflow:hidden}',
      '.acpSelPrefix{flex:none;padding:0 6px;border-radius:5px;font-size:10.5px;line-height:17px;font-weight:500;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2)}',
      '.acpSelMainText{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}',
      '.acpSelPlaceholder{color:var(--dsw-alias-label-secondary);font-weight:400}',
      '.acpSelChevron{flex:none;color:var(--dsw-alias-label-secondary);transition:transform .15s}',
      '.acpSelChevronOpen{transform:rotate(180deg);color:var(--dsw-static-deepseek-500, #4176e6)}',
      '.acpSelPopover{position:fixed;z-index:2200;display:flex;flex-direction:column;box-sizing:border-box;padding:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-specific-menu, var(--dsw-alias-bg-base));backdrop-filter:blur(22px) saturate(180%);-webkit-backdrop-filter:blur(22px) saturate(180%);box-shadow:var(--dsw-elevation-prominent, 0 14px 36px rgba(15,23,42,.16), 0 2px 8px rgba(15,23,42,.06));color:var(--dsw-alias-label-primary);font-family:inherit;animation:acp-pop-in .1s ease-out}',
      '.acpSelSubmenu{position:fixed;z-index:2210;display:flex;flex-direction:column;box-sizing:border-box;padding:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-specific-menu, var(--dsw-alias-bg-base));backdrop-filter:blur(22px) saturate(180%);-webkit-backdrop-filter:blur(22px) saturate(180%);box-shadow:var(--dsw-elevation-prominent, 0 14px 36px rgba(15,23,42,.16), 0 2px 8px rgba(15,23,42,.06));color:var(--dsw-alias-label-primary);font-family:inherit;animation:acp-pop-in .08s ease-out}',
      '.acpSelSubmenuHdr{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 9px 6px;margin-bottom:2px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11px;line-height:15px;font-weight:650;color:var(--dsw-alias-label-secondary);user-select:none}',
      '@keyframes acp-pop-in{from{opacity:0;transform:translateY(-3px) scale(.99)}to{opacity:1;transform:translateY(0) scale(1)}}',
      '.acpSelSearchBox{display:flex;align-items:center;gap:6px;margin:2px 2px 5px;padding:0 9px;height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base)}',
      '.acpSelSearchInput{flex:1;min-width:0;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}',
      '.acpSelViewport{display:flex;flex-direction:column;gap:1px;overflow-y:auto;min-height:0;padding:1px}',
      '.acpSelGroupHdr{padding:6px 9px 3px;font-size:10.5px;line-height:14px;font-weight:650;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));user-select:none}',
      '.acpSelRule{height:1px;margin:3px 4px;background:var(--dsw-alias-border-l1)}',
      '.acpSelChannelRow{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;box-sizing:border-box;padding:6px 9px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;text-align:left;cursor:pointer;transition:background .1s}',
      '.acpSelChannelRow:hover,.acpSelChannelActive{background:var(--dsw-alias-interactive-bg-hover)}',
      '.acpSelChannelSelected{color:var(--dsw-alias-state-business-primary, #4176e6);font-weight:600}',
      '.acpSelChannelLeft{display:flex;align-items:center;gap:6px;min-width:0;flex:1}',
      '.acpSelChannelName{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:550}',
      '.acpSelChannelRight{display:inline-flex;align-items:center;gap:5px;flex:none;color:var(--dsw-alias-label-secondary)}',
      '.acpSelChannelCount{padding:0 5px;border-radius:999px;font-size:10.5px;line-height:16px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.acpSelOption{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;width:100%;box-sizing:border-box;padding:6px 9px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;text-align:left;cursor:pointer;transition:background .1s}',
      '.acpSelOption:hover,.acpSelOptionFocus{background:var(--dsw-alias-interactive-bg-hover)}',
      '.acpSelOptionSelected{background:rgba(65,118,230,.09);color:var(--dsw-alias-state-business-primary, #4176e6)}',
      '.acpSelOptionSelected:hover{background:rgba(65,118,230,.13)}',
      '.acpSelOptBody{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}',
      '.acpSelOptTop{display:flex;align-items:center;gap:6px;min-width:0}',
      '.acpSelOptLabel{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.acpSelOptCode{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);flex:none}',
      '.acpSelOptDesc{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary)}',
      '.acpSelCheck{flex:none;width:15px;height:15px;margin-top:1px;color:var(--dsw-static-deepseek-500, #4176e6)}',
      '.acpSelFooter{margin-top:4px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.acpSelCustomBox{display:flex;align-items:center;gap:6px;width:100%}',

      /* Forms & sections */
      '.acpHubSection{margin-bottom:16px;padding:16px 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-base)}',
      '.acpHubSectionHead{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap}',
      '.acpHubSectionTitle{margin:0;font-size:13.5px;font-weight:650}',
      '.acpHubSectionDesc{margin:2px 0 0;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.acpHubGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px}',
      '.acpHubField{display:flex;flex-direction:column;gap:5px;min-width:0}',
      '.acpHubFieldFull{grid-column:1 / -1}',
      '.acpHubLabelRow{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.acpHubLabel{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.acpHubHint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
      '.acpHubInput,.acpHubTextarea{box-sizing:border-box;width:100%;min-height:36px;padding:6px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:20px;transition:border-color .14s,background .14s,box-shadow .14s}',
      '.acpHubMono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.acpHubTextarea{min-height:80px;resize:vertical}',
      '.acpHubInput:focus,.acpHubTextarea:focus{outline:none;background:var(--dsw-alias-bg-base);border-color:var(--dsw-static-deepseek-500, #4176e6);box-shadow:0 0 0 2px rgba(65,118,230,.14)}',
      '.acpHubToggleRow{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.acpHubToggleRow:first-child{border-top:none;padding-top:0}',
      '.acpHubToggleRow:last-child{padding-bottom:0}',

      /* Preset gallery & disclosure radio cards */
      '.acpHubPresetGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:18px}',
      '.acpHubPresetCard{display:flex;flex-direction:column;justify-content:space-between;gap:10px;padding:13px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base)}',
      '.acpHubPresetTop{display:flex;align-items:center;gap:10px}',
      '.acpHubNotice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 15px;margin-bottom:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-module-platform));font-size:12px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}',
      '.acpHubAlertErr{padding:9px 12px;margin-bottom:12px;border:1px solid var(--dsw-alias-state-error-primary, #ef4444);border-radius:8px;color:var(--dsw-alias-state-error-primary, #ef4444);background:var(--dsw-static-red-600-a08, rgba(236,19,19,.05));font-size:12px;white-space:pre-wrap}',
      '.acpHubNoteOk{font-size:12px;color:var(--dsw-alias-state-success-primary, #10b981)}',
      '.acpHubItemGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}',
      '.acpHubCheckCard{display:flex;align-items:flex-start;gap:9px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-module-platform);cursor:pointer;transition:border-color .12s}',
      '.acpHubCheckCard:hover{border-color:var(--dsw-static-deepseek-500, #4176e6)}',
      '.acpHubCheckCardLocked{border-color:rgba(16,185,129,.32);background:var(--dsw-static-green-500-a08, rgba(34,197,94,.06));cursor:default}',
      '.acpHubCheckCardLocked:hover{border-color:rgba(16,185,129,.32)}',
      '.acpHubCheckCardDisabled{opacity:.65;cursor:not-allowed}',
      '.acpHubCheckCardDisabled:hover{border-color:var(--dsw-alias-border-l2)}',
      '.acpHubDrawerBar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.acpHubDrawerSummary{display:flex;align-items:center;gap:8px;min-width:0;flex:1;flex-wrap:wrap}',
      '.acpHubDrawerCmd{max-width:460px;padding:2px 8px;border-radius:6px;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l1);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.acpHubRadioGroup{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
      '.acpHubRadioCard{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-module-platform);cursor:pointer;text-align:left;font:inherit;color:inherit;transition:border-color .12s,background .12s}',
      '.acpHubRadioCard:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.acpHubRadioCardActive{border-color:var(--dsw-static-deepseek-500, #4176e6);background:rgba(65,118,230,.07)}',

      /* Side-by-side Native MCP & Skills Inspector + Clickable Header Filter Pills */
      '.acpInspectorSplit{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}',
      '.acpInspCol{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-base);min-width:0;overflow:hidden}',
      '.acpInspColHead{display:flex;flex-direction:column;gap:8px;padding:13px 15px 11px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-module-platform))}',
      '.acpInspColTop{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
      '.acpInspColTitleRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}',
      '.acpInspTabGroup{display:inline-flex;align-items:center;gap:4px;padding:2px;border-radius:999px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2)}',
      '.acpInspTabPill{display:inline-flex;align-items:center;gap:4px;padding:1px 9px;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:17px;font-weight:550;font-variant-numeric:tabular-nums;cursor:pointer;transition:background .12s,color .12s,border-color .12s}',
      '.acpInspTabPill:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.acpInspTabPillOkActive{color:var(--dsw-alias-state-success-primary, #10b981);background:var(--dsw-static-green-500-a08, rgba(34,197,94,.11));border-color:rgba(16,185,129,.28);font-weight:650}',
      '.acpInspTabPillOkActive:hover{color:var(--dsw-alias-state-success-primary, #10b981);background:var(--dsw-static-green-500-a08, rgba(34,197,94,.15))}',
      '.acpInspTabPillMutedActive{color:var(--dsw-alias-state-business-primary, #4176e6);background:rgba(65,118,230,.11);border-color:rgba(65,118,230,.28);font-weight:650}',
      '.acpInspTabPillMutedActive:hover{color:var(--dsw-alias-state-business-primary, #4176e6);background:rgba(65,118,230,.15)}',
      '.acpInspSwitchLink{margin-left:6px;padding:0;border:none;background:transparent;color:var(--dsw-alias-state-business-primary, #4176e6);font:inherit;font-size:11.5px;font-weight:550;cursor:pointer;text-decoration:underline}',
      '.acpInspColBody{display:flex;flex-direction:column;padding:8px 10px 10px;gap:5px;max-height:68vh;overflow-y:auto}',
      '.acpInspRow{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);transition:background .12s,border-color .12s}',
      '.acpInspRow:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}',
      '.acpInspRowMuted{opacity:.76;background:var(--dsw-alias-bg-module-platform)}',
      '.acpInspRowLeft{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
      '.acpInspRowTitleLine{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}',
      '.acpInspRowName{font-weight:600;font-size:12.5px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
      '.acpInspRowDesc{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}',
      '.acpInspRowActions{display:flex;align-items:center;gap:4px;flex:none;align-self:center}',

      /* Chat delegation call card */
      '.acpAgentCallWrap{display:flex;align-items:center;gap:6px;width:100%}',
      '.acpAgentCall{display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);min-width:0;flex:1;text-align:left;font:inherit;color:inherit;transition:border-color .12s,background .12s}',
      'button.acpAgentCall{cursor:pointer}',
      'button.acpAgentCall:hover{border-color:var(--dsw-static-deepseek-500, #4176e6);background:var(--dsw-alias-interactive-bg-hover)}',
      '.acpAgentMark{display:inline-flex;align-items:center;justify-content:center;flex:none;width:26px;height:26px;padding:0;border:none;background:transparent}',
      '.acpAgentMark img{display:block;width:100%;height:100%;object-fit:contain}',
      '.acpAgentCopy{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
      '.acpAgentName{display:flex;align-items:center;gap:6px;font-weight:650;min-width:0}',
      '.acpAgentBadge{font-size:10px;line-height:16px;font-weight:600;padding:0 6px;border-radius:999px;color:var(--dsw-alias-state-business-primary, #4176e6);background:rgba(65,118,230,.1)}',
      '.acpAgentMeta{color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.acpAgentRight{display:flex;align-items:center;gap:8px;margin-left:auto;flex:none}',
      '.acpAgentStatCol{display:flex;flex-direction:column;align-items:flex-end;gap:2px}',
      '.acpAgentStatus{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}',
      '.acpAgentStatus.running{color:var(--dsw-alias-state-business-primary, #4176e6)}',
      '.acpAgentPulse{width:9px;height:9px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:acp-agent-spin .8s linear infinite;flex:none}',
      '@keyframes acp-agent-spin{to{transform:rotate(360deg)}}',
      '.acpAgentDuration{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.acpAgentStopBtn{height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-state-error-primary, #ef4444);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}',
      '.acpAgentStopBtn:hover{border-color:var(--dsw-alias-state-error-primary, #ef4444);background:var(--dsw-static-red-600-a08, rgba(236,19,19,.06))}',

      /* Native-Identical Subagent Composer (`InputBar` Capsule + Read-Only Frame) */
      '.acpInRoot{display:flex;flex-direction:column;align-items:center;padding:0 var(--dsh-composer-side-clearance, 24px) 4px}',
      '.acpInNotice{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width, 800px);margin-bottom:6px;padding:5px 10px;border-radius:var(--dsw-radius-md, 8px);background:var(--dsw-static-red-600-a08, rgba(236,19,19,.06));color:var(--dsw-alias-state-error-primary, #ef4444);font-size:12px;line-height:18px;white-space:pre-wrap}',
      '.acpInCard{box-sizing:border-box;position:relative;display:flex;flex-direction:column;gap:12px;width:100%;max-width:var(--dsh-composer-card-max-width, 800px);padding-top:8px;border:0;--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-panel, 16px);background:var(--dsw-specific-input-major, var(--dsw-alias-bg-base));box-shadow:var(--dsw-elevation-soft, 0 0 0 1px var(--dsw-alias-border-l2), 0 2px 8px rgba(0,0,0,.04));font-size:var(--dsh-content-font-size, 14px);line-height:calc(24px + var(--dsh-content-font-delta, 0px));--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}',
      '.acpInScroll{max-height:var(--dsh-composer-text-max-height, 240px);overflow-y:auto;margin-right:4px}',
      '.acpInTextarea{display:block;box-sizing:border-box;width:100%;min-height:36px;max-height:var(--dsh-composer-text-max-height, 240px);padding:4px 8px 0 14px;border:none;outline:none;resize:none;background:transparent;color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary, #3964FE);font-family:var(--dsw-font-family, inherit);font-size:inherit;line-height:inherit}',
      '.acpInTextarea::placeholder{color:var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.acpInTextareaDisabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}',
      '.acpInRow{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:2px 8px 6px;min-width:0;container-type:inline-size}',
      '.acpInTools{display:flex;align-items:center;gap:10px;min-width:0}',
      '.acpInAgentBadge{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border-radius:var(--dsw-radius-sm, 6px);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:500;white-space:nowrap}',
      '.acpInAgentIcon{display:inline-flex;width:16px;height:16px;flex:none}',
      '.acpInAgentIcon img{display:block;width:100%;height:100%;object-fit:contain}',
      '.acpInRoundTag{padding:0 5px;border-radius:999px;font-size:11px;line-height:16px;font-weight:600;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));font-variant-numeric:tabular-nums}',
      '.acpInChip{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm, 6px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;cursor:pointer;transition:background .12s,color .12s}',
      '.acpInChip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.acpInChipActive{color:var(--dsw-alias-state-business-primary, #4176e6);background:rgba(65,118,230,.1)}',
      '.acpInChipActive:hover:not(:disabled){background:rgba(65,118,230,.15);color:var(--dsw-alias-state-business-primary, #4176e6)}',
      '.acpInTrailing{display:flex;align-items:center;flex:none;margin-left:auto;gap:12px;min-width:0}',
      '.acpInModelCap{max-width:220px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.acpInPrimary{display:grid;place-items:center;flex:none;width:34px;height:34px;padding:0;border:none;border-radius:999px;background:var(--dsw-alias-button-info-fill, #3964FE);color:#fff;cursor:pointer;transition:background-color 100ms ease,opacity 100ms ease;transform:translateY(-2px)}',
      '.acpInPrimary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover, #2952e8)}',
      '.acpInPrimary:disabled{opacity:.4;cursor:default}',
      '.acpRoFrame{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width, 800px);min-height:54px;padding:10px 16px;border:0.5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-lg, 12px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}',
      '.acpRoFrame strong{color:var(--dsw-alias-label-primary);font-weight:510}',

      /* Subagent Bottom Stats Dock (`ActivityPill` + `UsagePill` + `ContextMeter`) */
      '.acpDock{display:flex;align-items:center;justify-content:center;gap:12px;max-width:100%;min-height:calc(22px + var(--dsh-content-font-delta-secondary, 0px));padding-top:4px;flex-wrap:wrap}',
      '.acpDockPulse{display:inline-block;width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-button-info-fill, #3964FE);animation:acpPulse 1.4s ease-in-out infinite}',
      '@keyframes acpPulse{0%,100%{opacity:1}50%{opacity:.35}}',
      '.acpStatAnchor{display:inline-flex;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary, 13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary, 0px))}',
      '.acpStatPill{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;max-width:100%;padding:1px 8px;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap}',
      '.acpStatPill svg{width:14px;height:14px;flex:none}',
      'button.acpStatPill{cursor:pointer}',
      'button.acpStatPill:hover,button.acpStatPill[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.acpStatLabel{min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.acpStatSep{color:var(--dsw-alias-separator-primary, var(--dsw-alias-label-tertiary));margin:0 6px}',
      '.acpStatDialog{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,calc(100vw - 24px));max-width:min(440px,calc(100vw - 24px));padding:16px;border:0;border-radius:var(--dsw-radius-lg, 12px);background:var(--dsw-specific-menu, var(--dsw-alias-bg-base));backdrop-filter:var(--dsw-menu-backdrop-filter, blur(20px));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.16));font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:default}',
      '.acpStatDlgTitle{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500}',
      '.acpStatDlgLabel{display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.acpStatDlgLabel svg{width:14px;height:14px;flex:none}',
      '.acpStatDlgVal{font-variant-numeric:tabular-nums}',
      '.acpStatDlgRule{margin-bottom:10px;border-top:0.5px solid var(--dsw-alias-border-l2)}',
      '.acpStatDetails{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;color:var(--dsw-alias-label-tertiary)}',
      '.acpStatDetails dt,.acpStatDetails dd{min-width:0;margin:0}',
      '.acpStatDetails dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}',
      '.acpCtxRoot{display:inline-flex;flex:none}',
      '.acpCtxTrigger{display:inline-flex;align-items:center;gap:6px;flex:none;padding:1px 8px;border:none;border-radius:var(--dsw-radius-sm, 6px);background:transparent;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary, 13px);font-variant-numeric:tabular-nums;line-height:calc(20px + var(--dsh-content-font-delta-secondary, 0px));white-space:nowrap;cursor:pointer}',
      '.acpCtxTrigger:hover,.acpCtxTrigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.acpCtxTrack{fill:none;stroke:var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));stroke-width:2}',
      '.acpCtxFill{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:2;stroke-linecap:round}',
      '.acpCtxDialog{position:fixed;z-index:1100;box-sizing:border-box;width:min(264px,calc(100vw - 24px));padding:12px;border:0;border-radius:var(--dsw-radius-lg, 12px);background:var(--dsw-specific-menu, var(--dsw-alias-bg-base));backdrop-filter:var(--dsw-menu-backdrop-filter, blur(20px));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.16));font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);cursor:default}',
      '.acpCtxHdr{display:flex;align-items:center;gap:6px}',
      '.acpCtxHeadline{color:var(--dsw-alias-label-tertiary)}',
      '.acpCtxHeadline:empty{display:none}',
      '.acpCtxPercent{font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.acpCtxFigures{margin-left:auto;font-weight:500;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
      '.acpCtxBar{display:flex;gap:1px;margin:10px 0 12px;height:4px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden}',
      '.acpCtxSeg{flex:none;min-width:2px;height:100%;border-radius:1px;background:var(--meter-tint, var(--dsw-alias-label-tertiary))}',
      '.acpCtxColorSys{--meter-tint:var(--dsw-static-neutral-bluish-400, #94a3b8)}',
      '.acpCtxColorTools{--meter-tint:rgb(167,139,250)}',
      '.acpCtxColorMsgs{--meter-tint:var(--dsw-static-blue-450, #3b82f6)}',
      '.acpCtxRows{margin:6px 0 0}',
      '.acpCtxRow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 0}',
      '.acpCtxRow dt{color:var(--dsw-alias-label-secondary)}',
      '.acpCtxRow dd{margin:0;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
      '.acpCtxSwatch{display:inline-block;margin-right:6px;width:8px;height:8px;border-radius:2px;background:var(--meter-tint);vertical-align:baseline}',
      '@media (max-width:980px){.acpInspectorSplit{grid-template-columns:minmax(0,1fr)}.acpInspColBody{max-height:none}}',
      '@media (max-width:880px){.acpHubPage{flex-direction:column}.acpHubRail{flex:0 0 auto;width:100%;max-height:38%;border-right:none;border-bottom:1px solid var(--dsw-alias-border-l2)}.acpHubGrid,.acpHubRadioGroup{grid-template-columns:minmax(0,1fr)}}',
    ].join('')

    function ensureStylesInjected() {
      if (typeof document === 'undefined' || !document.head) return false
      let styleEl = typeof document.getElementById === 'function'
        ? document.getElementById('dsh-acp-hub-styles')
        : null
      if (!styleEl) {
        styleEl = document.createElement('style')
        styleEl.id = 'dsh-acp-hub-styles'
        styleEl.textContent = STYLES
        document.head.appendChild(styleEl)
      } else if (styleEl.textContent !== STYLES) {
        styleEl.textContent = STYLES
      }
      return true
    }

    const sessionInfoCache = new Map()
    const MAX_SESSION_INFO_CACHE = 200

    function seedSessionInfoCache(childId, partial) {
      const id = String(childId || '').trim()
      if (!id || !partial || typeof partial !== 'object') return null
      const prev = sessionInfoCache.get(id) || {}
      const merged = { ...prev }
      for (const [k, v] of Object.entries(partial)) {
        if (v !== undefined && v !== '') merged[k] = v
      }
      merged.childId = id
      sessionInfoCache.delete(id)
      sessionInfoCache.set(id, merged)
      if (sessionInfoCache.size > MAX_SESSION_INFO_CACHE) {
        const oldest = sessionInfoCache.keys().next().value
        if (oldest !== undefined) sessionInfoCache.delete(oldest)
      }
      return merged
    }

    async function request(url, options) {
      const response = await fetch(url, { credentials: 'same-origin', ...options })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.ok === false) {
        throw new Error(body.error || `HTTP ${response.status}`)
      }
      return body
    }

    function ensureToolViewRegistered(key) {
      if (!key || registeredToolViews.has(key) || typeof slotRegistrar !== 'function') return
      registeredToolViews.add(key)
      try {
        slotRegistrar(key)
      } catch {}
    }

    function envToText(env) {
      return Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join('\n')
    }

    function textToEnv(raw) {
      const out = {}
      for (const line of String(raw || '').split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq <= 0) continue
        out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1)
      }
      return out
    }

    function parseCommandLine(raw) {
      const str = String(raw ?? '')
      const tokens = []
      let cur = ''
      let inToken = false
      let quote = null
      for (let i = 0; i < str.length; i += 1) {
        const ch = str[i]
        if (quote === "'") {
          if (ch === "'") quote = null
          else cur += ch
        } else if (quote === '"') {
          if (ch === '"') quote = null
          else if (ch === '\\') {
            if (i + 1 < str.length) {
              const next = str[i + 1]
              cur += (next === '"' || next === '\\') ? next : `\\${next}`
              i += 1
            } else cur += '\\'
          } else cur += ch
        } else if (/\s/.test(ch)) {
          if (inToken) {
            tokens.push(cur)
            cur = ''
            inToken = false
          }
        } else if (ch === "'" || ch === '"') {
          inToken = true
          quote = ch
        } else if (ch === '\\') {
          inToken = true
          if (i + 1 < str.length) {
            cur += str[i + 1]
            i += 1
          } else cur += '\\'
        } else {
          inToken = true
          cur += ch
        }
      }
      if (inToken) tokens.push(cur)
      return { command: tokens[0] ?? '', args: tokens.slice(1) }
    }

    function formatCommandLine(command, args = []) {
      const cmd = String(command ?? '').trim()
      if (!cmd) return ''
      const quoteToken = (tok) => {
        const s = String(tok ?? '')
        if (s.length === 0 || /[\s"'\\]/.test(s)) {
          return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
        }
        return s
      }
      const list = Array.isArray(args) ? args : []
      return [quoteToken(cmd), ...list.map(quoteToken)].join(' ')
    }

    function safeDecodeURIComponent(str) {
      try {
        return decodeURIComponent(str)
      } catch {
        return str
      }
    }

    function formatTopProviderName(raw) {
      const clean = String(raw || '').trim()
      if (!clean) return ''
      if (clean.toLowerCase() === 'minimax') return 'MiniMax'
      return clean
    }

    function canonicalizeFallbackModelId(modelId) {
      const s = String(modelId || '').trim()
      if (/^minimax-m/i.test(s)) {
        return s
          .replace(/^minimax-/i, 'MiniMax-')
          .replace(/-m(\d)/i, '-M$1')
          .replace(/-flash\b/gi, '-Flash')
          .replace(/-preview\b/gi, '-Preview')
      }
      return s
    }

    const REDUNDANT_CHANNEL_TAGS_RE = /\s*·\s*(?:routing group|WorkBuddy(?:\s+AI)?|OpenCode(?:\s+Go)?|Qoder(?:\s+CN)?|MiniMax(?:\s+Code)?)(?=\s*·|$)/gi

    function parseModelOption(rawValue, rawLabel = '') {
      const val = String(rawValue ?? '').trim()
      const lbl = String(rawLabel ?? '').trim()
      if (!val) {
        return { group: '', leaf: lbl || '', code: '', variant: '', modelId: '', fullLabel: lbl || '' }
      }

      // 1. MiniMax URI format: m:<provider>:<modelPart>[:v:<variant>]
      const mm = /^m:([^:]+):(.+?)(?::v:([^:]*))?$/.exec(val)
      if (mm) {
        const providerRaw = safeDecodeURIComponent(mm[1]).replace(/^custom_provider:/i, '')
        const providerClean = formatTopProviderName(providerRaw)
        const modelPart = safeDecodeURIComponent(mm[2])
        const variant = mm[3] !== undefined ? safeDecodeURIComponent(mm[3]).trim() : ''

        let group = providerClean
        let modelId = modelPart
        const tildeIdx = modelPart.indexOf('~')
        if (tildeIdx > 0 && tildeIdx < modelPart.length - 1) {
          const subchannel = modelPart.slice(0, tildeIdx).trim()
          modelId = modelPart.slice(tildeIdx + 1).trim()
          group = providerClean ? `${providerClean}/${subchannel}` : subchannel
        }

        let leaf = ''
        if (lbl && lbl !== val) {
          leaf = lbl.replace(REDUNDANT_CHANNEL_TAGS_RE, '').replace(/\s{2,}/g, ' ').trim()
        }
        if (!leaf) {
          const cleanBase = canonicalizeFallbackModelId(modelId)
          leaf = variant ? `${cleanBase} · ${variant}` : cleanBase
        }
        const showCode = modelId && !leaf.toLowerCase().includes(modelId.toLowerCase()) ? modelId : ''
        return {
          group,
          leaf,
          code: showCode,
          variant,
          modelId,
          fullLabel: group ? `${group} · ${leaf}` : leaf,
        }
      }

      // 2. Slash-delimited format: <provider>[/<subchannel>]/<leaf>
      const slashSource = val.includes('/') ? val : (lbl.includes('/') ? lbl : '')
      if (slashSource) {
        const lastSlash = slashSource.lastIndexOf('/')
        if (lastSlash > 0 && lastSlash < slashSource.length - 1) {
          const group = slashSource.slice(0, lastSlash).trim()
          const rawLeaf = slashSource.slice(lastSlash + 1).trim()
          const humanLeaf = lbl && !lbl.includes('/') && lbl !== val ? lbl : rawLeaf
          const showCode = rawLeaf && humanLeaf !== rawLeaf ? rawLeaf : ''
          return {
            group,
            leaf: humanLeaf,
            code: showCode,
            variant: '',
            modelId: rawLeaf,
            fullLabel: `${group}/${humanLeaf}`,
          }
        }
      }

      // 3. Colon-delimited <provider>:<leaf> (non m:..., no /)
      const firstColon = val.indexOf(':')
      if (firstColon > 0 && firstColon < val.length - 1) {
        const group = formatTopProviderName(safeDecodeURIComponent(val.slice(0, firstColon).trim()))
        const rawLeaf = safeDecodeURIComponent(val.slice(firstColon + 1).trim())
        const humanLeaf = lbl && lbl !== val ? lbl : rawLeaf
        return {
          group,
          leaf: humanLeaf,
          code: rawLeaf && humanLeaf !== rawLeaf ? rawLeaf : '',
          variant: '',
          modelId: rawLeaf,
          fullLabel: `${group} · ${humanLeaf}`,
        }
      }

      const fallbackLeaf = lbl || val
      return {
        group: '',
        leaf: fallbackLeaf,
        code: val !== fallbackLeaf ? val : '',
        variant: '',
        modelId: val,
        fullLabel: fallbackLeaf,
      }
    }

    function formatModelDisplay(modelValue, catalog = null) {
      const raw = String(modelValue ?? '').trim()
      if (!raw) {
        if (catalog?.current) return formatModelDisplay(catalog.current, catalog)
        return '默认模型'
      }
      const hit = Array.isArray(catalog?.models)
        ? catalog.models.find(m => m && m.value === raw)
        : null
      const parsed = parseModelOption(raw, hit?.name || '')
      return parsed.leaf || raw
    }

    function shortModelName(model, catalog = null) {
      if (!model) return '默认模型'
      return formatModelDisplay(model, catalog)
    }

    function formatAcpDuration(ms) {
      const total = Math.max(0, Math.floor(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      return hours > 0
        ? `${hours}时${String(minutes).padStart(2, '0')}分`
        : minutes > 0
          ? `${minutes}分${String(seconds).padStart(2, '0')}秒`
          : `${seconds}秒`
    }

    function ChevronIcon({ open, size = 13 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        className: 'acpSelChevron' + (open ? ' acpSelChevronOpen' : ''),
        'aria-hidden': 'true',
      }, h('path', {
        d: 'M4 6.2L8 10.2L12 6.2',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    function RightChevronIcon({ size = 12 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        style: { flex: 'none' },
        'aria-hidden': 'true',
      }, h('path', {
        d: 'M6.2 4L10.2 8L6.2 12',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    function CheckIcon() {
      return h('svg', {
        width: 15,
        height: 15,
        viewBox: '0 0 16 16',
        fill: 'none',
        className: 'acpSelCheck',
        'aria-hidden': 'true',
      }, h('path', {
        d: 'M3.2 8.3L6.5 11.6L12.8 4.6',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    function SearchIcon() {
      return h('svg', {
        width: 13,
        height: 13,
        viewBox: '0 0 16 16',
        fill: 'none',
        style: { flex: 'none', color: 'var(--dsw-alias-label-secondary)' },
        'aria-hidden': 'true',
      },
      h('circle', { cx: 7, cy: 7, r: 4.6, stroke: 'currentColor', strokeWidth: 1.5 }),
      h('path', { d: 'M10.5 10.5L13.6 13.6', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))
    }

    function portalOrInline(element) {
      if (!element) return null
      if (ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined' && document?.body) {
        return ReactDOM.createPortal(element, document.body)
      }
      return element
    }

    /* ---------------------------------------------------------------------- */
    /* Custom DSH-Styled Popover Select (`HubSelect` + Hover Cascade Flyout)  */
    /* ---------------------------------------------------------------------- */

    function HubSelect({
      value,
      options,
      onChange,
      disabled = false,
      compact = false,
      searchable = 'auto',
      groupBySlash = false,
      cascadeGroups = false,
      defaultOpen = false,
      initialActiveGroup = '',
      mono = false,
      allowCustom = false,
      customPlaceholder = '输入自定义值…',
      searchPlaceholder = '筛选选项…',
      emptyLabel = '无匹配项',
    }) {
      const [open, setOpen] = React.useState(Boolean(defaultOpen))
      const [query, setQuery] = React.useState('')
      const [customMode, setCustomMode] = React.useState(false)
      const [rect, setRect] = React.useState(() => (defaultOpen
        ? { left: 16, top: 48, width: 256, maxHeight: 340 }
        : null))
      const [activeGroup, setActiveGroup] = React.useState(initialActiveGroup || '')
      const [submenuPos, setSubmenuPos] = React.useState(() => (defaultOpen
        ? { left: 278, top: 48, width: 296, maxHeight: 340 }
        : null))

      const triggerRef = React.useRef(null)
      const popoverRef = React.useRef(null)
      const submenuRef = React.useRef(null)
      const searchInputRef = React.useRef(null)
      const channelRowRefs = React.useRef(new Map())

      const safeOpts = Array.isArray(options) ? options : []
      const matchedOpt = safeOpts.find(o => o.value === (value ?? ''))
      const isUnlistedValue = Boolean(value) && safeOpts.length > 0 && !matchedOpt

      const cascadeData = React.useMemo(() => {
        const pinned = []
        const groupMap = new Map()
        const ungrouped = []
        for (const opt of safeOpts) {
          if (cascadeGroups && opt.value === '') {
            pinned.push(opt)
            continue
          }
          const parsed = (groupBySlash || cascadeGroups) && opt.value
            ? parseModelOption(opt.value, opt.label)
            : { group: '', leaf: opt.label, code: opt.code || '' }
          const enriched = {
            ...opt,
            parsedGroup: parsed.group,
            parsedLeaf: parsed.leaf || opt.label,
            parsedCode: opt.code || parsed.code || '',
          }
          if (parsed.group) {
            if (!groupMap.has(parsed.group)) groupMap.set(parsed.group, [])
            groupMap.get(parsed.group).push(enriched)
          } else {
            ungrouped.push(enriched)
          }
        }
        const groups = Array.from(groupMap.entries()).map(([name, items]) => ({
          name,
          items,
          hasSelected: items.some(it => it.value === (value ?? '')),
        }))
        return { pinned, groups, ungrouped }
      }, [safeOpts, cascadeGroups, groupBySlash, value])

      const effectiveActiveGroup = React.useMemo(() => {
        if (cascadeData.groups.length === 0) return ''
        if (activeGroup && cascadeData.groups.some(g => g.name === activeGroup)) return activeGroup
        const selectedGroup = cascadeData.groups.find(g => g.hasSelected)
        return selectedGroup ? selectedGroup.name : cascadeData.groups[0].name
      }, [activeGroup, cascadeData.groups])

      React.useEffect(() => {
        if (isUnlistedValue && allowCustom) setCustomMode(true)
      }, [isUnlistedValue, allowCustom])

      const computeSubmenuPosition = React.useCallback((groupName, baseRect) => {
        const winW = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1280
        const winH = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800
        const popRect = popoverRef.current?.getBoundingClientRect?.()
          || (baseRect ? {
            left: baseRect.left,
            right: baseRect.left + baseRect.width,
            top: baseRect.top ?? 48,
          } : { left: 16, right: 272, top: 48 })
        const rowEl = groupName ? channelRowRefs.current.get(groupName) : null
        const rowRect = rowEl?.getBoundingClientRect?.() || null
        const subW = Math.min(316, Math.max(248, winW - 24))
        const placeLeft = popRect.right + 6 + subW + 12 > winW && popRect.left - 6 - subW >= 12
        const left = placeLeft
          ? Math.max(12, popRect.left - subW - 6)
          : Math.max(12, Math.min(winW - subW - 12, popRect.right + 6))
        const maxH = Math.max(160, Math.min(372, winH - 24))
        const anchorTop = rowRect ? rowRect.top - 6 : (popRect.top ?? 48)
        const top = Math.max(12, Math.min(anchorTop, winH - Math.min(maxH, 260) - 12))
        setSubmenuPos({ left, top, width: subW, maxHeight: maxH })
      }, [])

      const updatePosition = React.useCallback(() => {
        if (!triggerRef.current) return
        const r = triggerRef.current.getBoundingClientRect()
        const vh = window.innerHeight || 800
        const vw = window.innerWidth || 1200
        const spaceBelow = vh - r.bottom - 12
        const spaceAbove = r.top - 12
        const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow
        const maxH = Math.max(140, Math.min(360, (placeAbove ? spaceAbove : spaceBelow) - 8))
        const baseWidth = cascadeGroups ? Math.min(Math.max(r.width, 240), 300) : Math.max(r.width, compact ? 160 : 230)
        const width = Math.min(vw - 24, baseWidth)
        const left = Math.max(12, Math.min(r.left, vw - width - 12))
        const nextRect = {
          left,
          width,
          maxHeight: maxH,
          top: placeAbove ? undefined : r.bottom + 5,
          bottom: placeAbove ? vh - r.top + 5 : undefined,
        }
        setRect(nextRect)
        if (cascadeGroups && effectiveActiveGroup) {
          computeSubmenuPosition(effectiveActiveGroup, nextRect)
        }
      }, [compact, cascadeGroups, effectiveActiveGroup, computeSubmenuPosition])

      React.useEffect(() => {
        if (!open) return undefined
        updatePosition()
        if (typeof window === 'undefined') return undefined
        const timer = setTimeout(() => {
          searchInputRef.current?.focus?.()
          if (cascadeGroups && effectiveActiveGroup) {
            computeSubmenuPosition(effectiveActiveGroup, null)
          }
        }, 15)
        const onPointerDown = (e) => {
          const t = e.target
          if (
            triggerRef.current?.contains(t)
            || popoverRef.current?.contains(t)
            || submenuRef.current?.contains(t)
          ) {
            return
          }
          setOpen(false)
        }
        const onKeyDown = (e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setOpen(false)
            triggerRef.current?.focus?.()
          }
        }
        const onScrollOrResize = (e) => {
          if (
            e?.type === 'scroll'
            && (popoverRef.current?.contains(e.target) || submenuRef.current?.contains(e.target))
          ) {
            return
          }
          updatePosition()
        }
        window.addEventListener('mousedown', onPointerDown, true)
        window.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('resize', onScrollOrResize)
        window.addEventListener('scroll', onScrollOrResize, true)
        return () => {
          clearTimeout(timer)
          window.removeEventListener('mousedown', onPointerDown, true)
          window.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('resize', onScrollOrResize)
          window.removeEventListener('scroll', onScrollOrResize, true)
        }
      }, [open, updatePosition, cascadeGroups, effectiveActiveGroup, computeSubmenuPosition])

      if (allowCustom && customMode) {
        return h('div', { className: 'acpSelCustomBox' },
          h('input', {
            className: 'acpHubInput' + (mono ? ' acpHubMono' : ''),
            value: value || '',
            placeholder: customPlaceholder,
            onChange: e => onChange(e.target.value),
          }),
          safeOpts.length > 0
            ? h('button', {
              type: 'button',
              className: 'acpHubBtn acpHubBtnSm',
              style: { height: '36px', padding: '0 10px' },
              onClick: () => { setCustomMode(false) },
              title: '切回下拉列表选择',
            }, '列表 ▾')
            : null)
      }

      const showSearch = searchable === true || cascadeGroups || (searchable === 'auto' && safeOpts.length > 7)
      const q = query.trim().toLowerCase()
      const useCascadeView = Boolean(cascadeGroups && !q && cascadeData.groups.length > 0)

      const selectOption = (nextVal) => {
        onChange(nextVal)
        setOpen(false)
        setQuery('')
      }

      const focusSubmenuFirst = () => {
        const firstBtn = submenuRef.current?.querySelector?.('button[role="option"][aria-selected="true"]')
          || submenuRef.current?.querySelector?.('button[role="option"]')
        firstBtn?.focus?.()
      }

      // Build primary viewport rows
      const renderedRows = []
      if (useCascadeView) {
        for (const pin of cascadeData.pinned) {
          const selected = (value ?? '') === pin.value
          renderedRows.push(h('button', {
            key: `pin:${pin.value}`,
            type: 'button',
            role: 'option',
            'aria-selected': selected,
            className: 'acpSelOption' + (selected ? ' acpSelOptionSelected' : ''),
            onClick: () => selectOption(pin.value),
          },
          h('span', { className: 'acpSelOptBody' },
            h('span', { className: 'acpSelOptTop' },
              h('span', { className: 'acpSelOptLabel' }, pin.label))),
          selected ? h(CheckIcon) : null))
        }
        if (cascadeData.pinned.length > 0) {
          renderedRows.push(h('div', { key: 'pin-rule', className: 'acpSelRule', 'aria-hidden': 'true' }))
        }
        renderedRows.push(h('div', { key: 'chn-hdr', className: 'acpSelGroupHdr' }, '供应商 / 渠道（悬停展开模型）'))

        cascadeData.groups.forEach((grp, idx) => {
          const isActive = grp.name === effectiveActiveGroup
          renderedRows.push(h('button', {
            key: `chn:${grp.name}`,
            ref: (el) => {
              if (el) channelRowRefs.current.set(grp.name, el)
              else channelRowRefs.current.delete(grp.name)
            },
            type: 'button',
            role: 'menuitem',
            'aria-haspopup': 'listbox',
            'aria-expanded': isActive,
            'data-channel-group': grp.name,
            className: 'acpSelChannelRow'
              + (isActive ? ' acpSelChannelActive' : '')
              + (grp.hasSelected ? ' acpSelChannelSelected' : ''),
            onMouseEnter: () => {
              setActiveGroup(grp.name)
              computeSubmenuPosition(grp.name, rect)
            },
            onFocus: () => {
              setActiveGroup(grp.name)
              computeSubmenuPosition(grp.name, rect)
            },
            onClick: () => {
              setActiveGroup(grp.name)
              computeSubmenuPosition(grp.name, rect)
              setTimeout(focusSubmenuFirst, 0)
            },
            onKeyDown: (e) => {
              if (e.key === 'ArrowRight' || e.key === 'Enter') {
                e.preventDefault()
                focusSubmenuFirst()
              } else if (e.key === 'ArrowDown') {
                const nextGrp = cascadeData.groups[(idx + 1) % cascadeData.groups.length]
                if (nextGrp) {
                  e.preventDefault()
                  channelRowRefs.current.get(nextGrp.name)?.focus?.()
                }
              } else if (e.key === 'ArrowUp') {
                const prevGrp = cascadeData.groups[(idx - 1 + cascadeData.groups.length) % cascadeData.groups.length]
                if (prevGrp) {
                  e.preventDefault()
                  channelRowRefs.current.get(prevGrp.name)?.focus?.()
                }
              }
            },
          },
          h('span', { className: 'acpSelChannelLeft' },
            grp.hasSelected ? h('span', { className: 'acpHubDot', style: { background: 'var(--dsw-alias-state-business-primary, #4176e6)' } }) : null,
            h('span', { className: 'acpSelChannelName' }, grp.name)),
          h('span', { className: 'acpSelChannelRight' },
            h('span', { className: 'acpSelChannelCount' }, grp.items.length),
            h(RightChevronIcon))))
        })

        for (const opt of cascadeData.ungrouped) {
          const selected = (value ?? '') === opt.value
          renderedRows.push(h('button', {
            key: `ung:${opt.value}`,
            type: 'button',
            role: 'option',
            'aria-selected': selected,
            className: 'acpSelOption' + (selected ? ' acpSelOptionSelected' : ''),
            onClick: () => selectOption(opt.value),
          },
          h('span', { className: 'acpSelOptBody' },
            h('span', { className: 'acpSelOptTop' },
              h('span', { className: 'acpSelOptLabel' + (mono || opt.mono ? ' acpHubMono' : '') }, opt.parsedLeaf),
              opt.parsedCode ? h('span', { className: 'acpSelOptCode' }, opt.parsedCode) : null)),
          selected ? h(CheckIcon) : null))
        }
      } else {
        const filtered = q
          ? safeOpts.filter((o) => {
            const parsed = (groupBySlash || cascadeGroups) && o.value
              ? parseModelOption(o.value, o.label)
              : { group: '', leaf: o.label || '', code: o.code || '' }
            return (o.label || '').toLowerCase().includes(q)
              || (o.value || '').toLowerCase().includes(q)
              || parsed.group.toLowerCase().includes(q)
              || parsed.leaf.toLowerCase().includes(q)
              || parsed.code.toLowerCase().includes(q)
              || (o.description || '').toLowerCase().includes(q)
          })
          : safeOpts

        let lastGroup = null
        for (const opt of filtered) {
          const parsed = (groupBySlash || cascadeGroups) && opt.value
            ? parseModelOption(opt.value, opt.label)
            : { group: '', leaf: opt.label, code: opt.code || '' }
          const groupTitle = parsed.group
          const rowLabel = groupTitle ? parsed.leaf : opt.label
          const rowCode = opt.code || parsed.code || ''

          if (!q && groupTitle && groupTitle !== lastGroup) {
            lastGroup = groupTitle
            renderedRows.push(h('div', { key: `grp:${groupTitle}`, className: 'acpSelGroupHdr' }, groupTitle))
          }
          const selected = (value ?? '') === opt.value
          renderedRows.push(h('button', {
            key: `opt:${opt.value}`,
            type: 'button',
            role: 'option',
            'aria-selected': selected,
            className: 'acpSelOption' + (selected ? ' acpSelOptionSelected' : ''),
            onClick: () => selectOption(opt.value),
          },
          h('span', { className: 'acpSelOptBody' },
            h('span', { className: 'acpSelOptTop' },
              q && groupTitle ? h('span', { className: 'acpSelPrefix' }, groupTitle) : null,
              h('span', { className: 'acpSelOptLabel' + (mono || opt.mono ? ' acpHubMono' : '') }, rowLabel),
              rowCode ? h('span', { className: 'acpSelOptCode' }, rowCode) : null),
            opt.description ? h('span', { className: 'acpSelOptDesc' }, opt.description) : null),
          selected ? h(CheckIcon) : null))
        }
      }

      // Compute trigger display
      let triggerPrefix = ''
      let triggerMain = matchedOpt ? matchedOpt.label : (value ? formatModelDisplay(value) : (safeOpts[0]?.label || ''))
      if ((groupBySlash || cascadeGroups) && matchedOpt && matchedOpt.value) {
        const sp = parseModelOption(matchedOpt.value, matchedOpt.label)
        if (sp.group) {
          triggerPrefix = sp.group
          triggerMain = sp.leaf
        }
      }

      const activeGroupObj = useCascadeView
        ? cascadeData.groups.find(g => g.name === effectiveActiveGroup) || null
        : null

      const submenuEl = open && useCascadeView && activeGroupObj && submenuPos
        ? h('div', {
          ref: submenuRef,
          role: 'listbox',
          'aria-label': `${activeGroupObj.name} 模型列表`,
          'data-cascade-submenu': activeGroupObj.name,
          className: 'acpSelSubmenu',
          style: {
            left: `${submenuPos.left}px`,
            top: `${submenuPos.top}px`,
            width: `${submenuPos.width}px`,
            maxHeight: `${submenuPos.maxHeight}px`,
          },
          onKeyDown: (e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              channelRowRefs.current.get(activeGroupObj.name)?.focus?.()
            }
          },
        },
        h('div', { className: 'acpSelSubmenuHdr' },
          h('span', null, activeGroupObj.name),
          h('span', { style: { fontWeight: 500 } }, `${activeGroupObj.items.length} 个模型`)),
        h('div', { className: 'acpSelViewport' },
          ...activeGroupObj.items.map((opt, mIdx) => {
            const selected = (value ?? '') === opt.value
            return h('button', {
              key: `sub:${opt.value}`,
              type: 'button',
              role: 'option',
              'aria-selected': selected,
              className: 'acpSelOption' + (selected ? ' acpSelOptionSelected' : ''),
              onClick: () => selectOption(opt.value),
              onKeyDown: (e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  const buttons = submenuRef.current?.querySelectorAll?.('button[role="option"]')
                  if (buttons && buttons.length > 0) {
                    e.preventDefault()
                    const delta = e.key === 'ArrowDown' ? 1 : -1
                    const nextIdx = (mIdx + delta + buttons.length) % buttons.length
                    buttons[nextIdx]?.focus?.()
                  }
                }
              },
            },
            h('span', { className: 'acpSelOptBody' },
              h('span', { className: 'acpSelOptTop' },
                h('span', { className: 'acpSelOptLabel' + (mono || opt.mono ? ' acpHubMono' : '') }, opt.parsedLeaf),
                opt.parsedCode ? h('span', { className: 'acpSelOptCode' }, opt.parsedCode) : null),
              opt.description ? h('span', { className: 'acpSelOptDesc' }, opt.description) : null),
            selected ? h(CheckIcon) : null)
          })))
        : null

      const popoverEl = open && rect
        ? h('div', {
          ref: popoverRef,
          role: 'listbox',
          className: 'acpSelPopover',
          style: {
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            ...(rect.top !== undefined ? { top: `${rect.top}px` } : {}),
            ...(rect.bottom !== undefined ? { bottom: `${rect.bottom}px` } : {}),
            maxHeight: `${rect.maxHeight}px`,
          },
        },
        showSearch
          ? h('div', { className: 'acpSelSearchBox' },
            h(SearchIcon),
            h('input', {
              ref: searchInputRef,
              className: 'acpSelSearchInput',
              placeholder: searchPlaceholder,
              value: query,
              onChange: e => setQuery(e.target.value),
            }))
          : null,
        h('div', { className: 'acpSelViewport' },
          renderedRows.length > 0
            ? renderedRows
            : h('div', { style: { padding: '10px', textAlign: 'center', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, emptyLabel)),
        allowCustom
          ? h('div', { className: 'acpSelFooter' },
            h('button', {
              type: 'button',
              className: 'acpSelOption',
              onClick: () => {
                setOpen(false)
                setQuery('')
                setCustomMode(true)
              },
            },
            h('span', { className: 'acpSelOptBody' },
              h('span', { className: 'acpSelOptLabel', style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11.5px' } }, '✎ 手动输入自定义 ID…'))))
          : null)
        : null

      return h('div', { className: 'acpSelWrap', style: compact ? { width: 'auto' } : undefined },
        h('button', {
          ref: triggerRef,
          type: 'button',
          disabled,
          'aria-haspopup': 'listbox',
          'aria-expanded': open,
          className: 'acpSelTrigger'
            + (open ? ' acpSelTriggerOpen' : '')
            + (compact ? ' acpSelTriggerCompact' : ''),
          onClick: () => {
            if (disabled) return
            setOpen(v => !v)
          },
        },
        h('span', { className: 'acpSelValWrap' },
          triggerPrefix ? h('span', { className: 'acpSelPrefix' }, triggerPrefix) : null,
          h('span', {
            className: 'acpSelMainText'
              + (mono || matchedOpt?.mono ? ' acpHubMono' : '')
              + (!value && matchedOpt ? ' acpSelPlaceholder' : ''),
          }, triggerMain)),
        h(ChevronIcon, { open })),
        portalOrInline(popoverEl),
        portalOrInline(submenuEl))
    }

    function Switch({ checked, disabled, onChange, title }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': Boolean(checked),
        title,
        disabled,
        className: 'acpHubSwitch' + (checked ? ' acpHubSwitchOn' : ''),
        onClick: (e) => {
          e.stopPropagation()
          if (!disabled) onChange(!checked)
        },
      }, h('span', { className: 'acpHubKnob' }))
    }

    function SidebarIcon() {
      return h('svg', {
        width: 18,
        height: 18,
        viewBox: '0 0 20 20',
        fill: 'none',
        'aria-hidden': 'true',
      },
      h('rect', { x: 2.2, y: 3, width: 6.8, height: 6.8, rx: 1.8, stroke: 'currentColor', strokeWidth: 1.6 }),
      h('rect', { x: 11, y: 10.2, width: 6.8, height: 6.8, rx: 1.8, stroke: 'currentColor', strokeWidth: 1.6 }),
      h('path', { d: 'M9 6.4h3.2a2.2 2.2 0 0 1 2.2 2.2v1.6', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      h('path', { d: 'M11 13.6H7.8a2.2 2.2 0 0 1-2.2-2.2V9.8', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeDasharray: '1.6 1.8' }),
      h('circle', { cx: 5.6, cy: 6.4, r: 1, fill: 'currentColor' }),
      h('circle', { cx: 14.4, cy: 13.6, r: 1, fill: 'currentColor' }))
    }

    /* ---------------------------------------------------------------------- */
    /* Shared Subagent Bottom Stats Dock (`ActivityPill`, `UsagePill`, Meter) */
    /* ---------------------------------------------------------------------- */

    const FALLBACK_CHAT_ZH = {
      'number.groupSeparator': ',',
      'number.thousand': '{value}K',
      'number.million': '{value}M',
      'duration.compactSeconds': '{seconds}秒',
      'duration.compactMinutes': '{minutes}分{seconds}秒',
      'stats.counts': '{turns} 轮 {steps} 步',
      'stats.cacheHit': '缓存命中 {percent}%',
      'stats.dialog.title': '会话统计',
      'stats.dialog.usageTitle': 'Token 用量',
      'stats.dialog.llmTime': '模型用时',
      'stats.dialog.toolTime': '工具调用用时',
      'stats.dialog.ttft': '首 token 平均（TTFT）',
      'stats.dialog.speed': '输出速度（TPS）',
      'message.tokensPerSecond': '{tps} tok/s',
      'message.turnUsage.cacheHit': '缓存命中',
      'message.turnUsage.input': '未缓存输入',
      'message.turnUsage.cacheRead': '缓存读取',
      'message.turnUsage.cacheWrite': '缓存写入',
      'message.turnUsage.output': '输出',
      'message.turnUsage.count': '{count} tok',
    }

    const FALLBACK_CONV_ZH = {
      'number.thousand': '{value}K',
      'number.million': '{value}M',
      'context.aria': '上下文已用 {percent}',
      'context.used': '上下文已用',
      'context.system': '系统提示词',
      'context.tools': '工具定义',
      'context.messages': '对话消息',
    }

    const FALLBACK_SUBAGENT_ZH = {
      'readonly.oneShot.title': '一次性子智能体记录',
      'readonly.title': '此子智能体暂时只读',
      'readonly.oneShot.body': '一次性任务不支持后续消息，可在这里查看完整执行记录。',
      'readonly.body': '父会话当前不在线，重新打开父会话后即可继续发送消息。',
      'readonly.unknown.body': '读取子会话后才能确定是否可继续。',
    }

    function interpolateTemplate(tpl, params) {
      if (!params) return tpl
      return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`))
    }

    function makeTranslator(ns, fallbackDict) {
      const bound = runtimeCtx?.locale?.bind?.(ns)
      return (key, params) => {
        if (typeof bound === 'function') {
          try {
            const out = bound(key, params)
            if (typeof out === 'string' && out !== key) return out
          } catch {}
        }
        const tpl = fallbackDict[key] ?? key
        return interpolateTemplate(tpl, params)
      }
    }

    function useExternalRevision(subscribable, readRev) {
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        if (!subscribable || typeof subscribable.subscribe !== 'function') return undefined
        return subscribable.subscribe(() => { bump(n => n + 1) })
      }, [subscribable])
      return readRev ? readRev(subscribable) : 0
    }

    function resolvePerformanceUsageSource() {
      try {
        const dockEntries = runtimeCtx?.slots?.entries?.('conversation.composer.dock')
        if (dockEntries) {
          for (const entry of dockEntries) {
            const injFn = entry?.options?.inject ?? entry?.inject
            if (typeof injFn === 'function') {
              const obs = injFn()?.hooks?.performanceUsage
              if (obs && typeof obs.getSnapshot === 'function') {
                return { kind: 'observable', source: obs }
              }
            }
          }
        }
      } catch {}
      try {
        const forms = runtimeCtx?.configForms ?? runtimeCtx?.get?.('configForms')
        const uiChatForm = forms?.get?.('ui-chat')
        if (uiChatForm && typeof uiChatForm.getSnapshot === 'function') {
          return { kind: 'form', source: uiChatForm }
        }
      } catch {}
      return null
    }

    function usePerformanceUsageMode() {
      const resolved = resolvePerformanceUsageSource()
      useExternalRevision(resolved?.source)
      if (!resolved) return 'detailed'
      try {
        const snap = resolved.source.getSnapshot()
        const raw = resolved.kind === 'observable' ? snap : snap?.value?.performanceUsage
        return raw === 'compact' ? 'compact' : 'detailed'
      } catch {
        return 'detailed'
      }
    }

    function formatTokensCompact(value, t) {
      const scaled = candidate => (candidate >= 100
        ? String(Math.round(candidate))
        : String(Math.round(candidate * 10) / 10))
      if (value < 1_000) return String(value)
      if (value < 1_000_000) return t('number.thousand', { value: scaled(value / 1_000) })
      return t('number.million', { value: scaled(value / 1_000_000) })
    }

    function formatExactTokens(value, t) {
      const digits = String(Math.max(0, Math.trunc(value)))
      const groups = []
      for (let end = digits.length; end > 0; end -= 3) {
        groups.unshift(digits.slice(Math.max(0, end - 3), end))
      }
      return groups.join(t('number.groupSeparator'))
    }

    function roundedPercentUnits(cacheReadTokens, denominator, decimalPlaces) {
      const unitsPerPercent = decimalPlaces === 0 ? 1 : 10
      const scale = unitsPerPercent * 100
      const doubledScale = scale * 2
      const denominatorQuotient = Math.floor(denominator / doubledScale)
      const denominatorRemainder = denominator % doubledScale
      let lower = 0
      let upper = scale
      while (lower < upper) {
        const candidate = Math.floor((lower + upper + 1) / 2)
        const factor = candidate * 2 - 1
        const threshold = factor * denominatorQuotient
          + Math.ceil(factor * denominatorRemainder / doubledScale)
        if (cacheReadTokens >= threshold) lower = candidate
        else upper = candidate - 1
      }
      return lower
    }

    function formatCacheHitPercent(cacheReadTokens, promptTokens, decimalPlaces = 0) {
      if (promptTokens <= 0) return null
      const missedInputTokens = promptTokens - cacheReadTokens
      if (missedInputTokens <= 0) return '100'
      const roundedUnits = roundedPercentUnits(cacheReadTokens, promptTokens, decimalPlaces)
      const fullHitUnits = decimalPlaces === 0 ? 100 : 1_000
      if (roundedUnits < fullHitUnits) {
        if (decimalPlaces === 0) return String(roundedUnits)
        const whole = Math.floor(roundedUnits / 10)
        const tenths = roundedUnits % 10
        return tenths === 0 ? String(whole) : `${whole}.${tenths}`
      }
      let distinguishingPlaces = 1
      let scaledDoubleGap = missedInputTokens * 200
      const denominatorTens = Math.floor(promptTokens / 10)
      while (scaledDoubleGap <= denominatorTens) {
        scaledDoubleGap *= 10
        distinguishingPlaces += 1
      }
      const denominatorOnes = promptTokens % 10
      let roundedLoss = 5
      for (let loss = 1; loss < 5; loss += 1) {
        const factor = loss * 2 + 1
        const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10)
        if (scaledDoubleGap <= threshold) {
          roundedLoss = loss
          break
        }
      }
      return `99.${'9'.repeat(distinguishingPlaces - 1)}${10 - roundedLoss}`
    }

    function formatTokensPerSecond(tps) {
      const clamped = Math.max(0, tps)
      return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
    }

    function formatDurationCompact(ms, t) {
      const s = ms / 1_000
      if (s < 60) return t('duration.compactSeconds', { seconds: Math.round(s * 10) / 10 })
      const whole = Math.round(s)
      return t('duration.compactMinutes', { minutes: Math.floor(whole / 60), seconds: whole % 60 })
    }

    function deriveWindowStats(nodes) {
      const turns = new Set()
      let steps = 0
      let llmMs = 0
      let toolMs = 0
      let ttftMs = 0
      let ttftSteps = 0
      let decodeMs = 0
      let decodeTokens = 0
      for (const node of Array.isArray(nodes) ? nodes : []) {
        if (!node) continue
        if (node.kind === 'tool-result') {
          if (typeof node.callTime === 'number') toolMs += Math.max(0, node.time - node.callTime)
          continue
        }
        if (node.kind !== 'assistant') continue
        turns.add(node.turn)
        steps += 1
        const timing = node.timing
        if (timing && typeof timing.stepStartTime === 'number' && typeof timing.completedTime === 'number') {
          llmMs += Math.max(0, timing.completedTime - timing.stepStartTime)
        }
        if (timing && typeof timing.stepStartTime === 'number' && typeof timing.firstTokenTime === 'number') {
          ttftMs += Math.max(0, timing.firstTokenTime - timing.stepStartTime)
          ttftSteps += 1
        }
        const outTok = typeof node.usage?.outputTokens === 'number' && Number.isFinite(node.usage.outputTokens) && node.usage.outputTokens >= 0
          ? node.usage.outputTokens
          : null
        if (timing && typeof timing.firstTokenTime === 'number' && typeof timing.completedTime === 'number' && outTok !== null) {
          decodeMs += Math.max(0, timing.completedTime - timing.firstTokenTime)
          decodeTokens += outTok
        }
      }
      return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
    }

    function computeContextOccupancy(pressure) {
      const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
      const contextWindow = pressure?.contextWindow
      if (typeof usedTokens !== 'number' || typeof contextWindow !== 'number' || contextWindow <= 0) {
        return null
      }
      return {
        percent: Math.min(100, Math.max(0, Math.round((usedTokens / contextWindow) * 100))),
        usedTokens,
        contextWindow,
      }
    }

    function GaugeIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M2.75 11.5A6 6 0 1 1 13.25 11.5',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M8 8.5L10.8 5.4',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 8, cy: 8.5, r: 1.1, fill: 'currentColor' }))
    }

    function DatabaseIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': 'true' },
        h('ellipse', { cx: 8, cy: 3.8, rx: 4.8, ry: 1.9, stroke: 'currentColor', strokeWidth: 1.35 }),
        h('path', {
          d: 'M3.2 3.8V8C3.2 9.05 5.35 9.9 8 9.9C10.65 9.9 12.8 9.05 12.8 8V3.8',
          stroke: 'currentColor',
          strokeWidth: 1.35,
        }),
        h('path', {
          d: 'M3.2 8V12.2C3.2 13.25 5.35 14.1 8 14.1C10.65 14.1 12.8 13.25 12.8 12.2V8',
          stroke: 'currentColor',
          strokeWidth: 1.35,
        }))
    }

    function useAnchoredAboveDialog(active) {
      const [open, setOpen] = React.useState(false)
      const [pos, setPos] = React.useState(null)
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)

      React.useEffect(() => {
        if (!active && open) setOpen(false)
      }, [active, open])

      React.useEffect(() => {
        if (!open || !active || typeof window === 'undefined' || typeof document === 'undefined') return undefined
        const update = () => {
          const anchor = rootRef.current?.getBoundingClientRect?.()
          const panel = panelRef.current?.getBoundingClientRect?.()
          if (!anchor) return
          const vw = window.innerWidth || 1200
          const vh = window.innerHeight || 800
          const pw = panel?.width || 300
          const ph = panel?.height || 150
          const left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - pw / 2, vw - pw - 12))
          const aboveTop = anchor.top - ph - 8
          const top = aboveTop >= 12 ? aboveTop : Math.min(vh - ph - 12, anchor.bottom + 8)
          setPos({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, visibility: 'visible' })
        }
        update()
        const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(update) : null
        const onKeyDown = (e) => {
          if (e.key === 'Escape') setOpen(false)
        }
        const onOutside = (e) => {
          const t = e.target
          if (t && !rootRef.current?.contains?.(t) && !panelRef.current?.contains?.(t)) {
            setOpen(false)
          }
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('mousedown', onOutside, true)
        document.addEventListener('click', onOutside, true)
        window.addEventListener('resize', update)
        return () => {
          if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('mousedown', onOutside, true)
          document.removeEventListener('click', onOutside, true)
          window.removeEventListener('resize', update)
        }
      }, [open, active])

      return { open, setOpen, rootRef, panelRef, pos }
    }

    function StatDialogPill({ stat, icon, label, ariaLabel, title, titleValue, children }) {
      const { open, setOpen, rootRef, panelRef, pos } = useAnchoredAboveDialog(true)
      const dialogEl = open
        ? h('div', {
          ref: panelRef,
          className: 'acpStatDialog',
          role: 'dialog',
          'aria-label': title,
          style: pos || { visibility: 'hidden', left: 0, top: 0 },
        },
        h('div', { className: 'acpStatDlgTitle' },
          h('span', { className: 'acpStatDlgLabel' }, icon, title),
          titleValue !== undefined ? h('span', { className: 'acpStatDlgVal' }, titleValue) : null),
        h('div', { className: 'acpStatDlgRule', 'aria-hidden': 'true' }),
        children)
        : null

      return h('span', { ref: rootRef, className: 'acpStatAnchor', 'data-composer-stat': stat },
        h('button', {
          type: 'button',
          className: 'acpStatPill',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': ariaLabel,
          onClick: () => setOpen(v => !v),
        }, icon, h('span', { className: 'acpStatLabel' }, label)),
        portalOrInline(dialogEl))
    }

    function PlainStatPill({ stat, icon, label }) {
      return h('span', { className: 'acpStatAnchor', 'data-composer-stat': stat },
        h('span', { className: 'acpStatPill' }, icon, h('span', { className: 'acpStatLabel' }, label)))
    }

    function SubagentActivityPill({ stats, mode, tChat }) {
      const speed = stats.decodeMs > 0
        ? tChat('message.tokensPerSecond', { tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)) })
        : null
      const icon = h(GaugeIcon)
      if (mode === 'compact') {
        return speed === null ? null : h(PlainStatPill, { stat: 'activity', icon, label: speed })
      }
      if (stats.steps === 0) return null
      const counts = tChat('stats.counts', { turns: stats.turns, steps: stats.steps })
      const label = speed === null
        ? counts
        : h(React.Fragment, null, counts, h('span', { className: 'acpStatSep', 'aria-hidden': 'true' }, '·'), speed)
      if (stats.llmMs <= 0 && stats.toolMs <= 0 && stats.ttftSteps <= 0 && speed === null) {
        return h(PlainStatPill, { stat: 'activity', icon, label })
      }
      return h(StatDialogPill, {
        stat: 'activity',
        icon,
        label,
        ariaLabel: speed === null ? counts : `${counts} · ${speed}`,
        title: tChat('stats.dialog.title'),
      },
      h('dl', { className: 'acpStatDetails', 'data-session-stats-details': '' },
        stats.llmMs > 0 ? h(React.Fragment, null,
          h('dt', null, tChat('stats.dialog.llmTime')),
          h('dd', null, formatDurationCompact(stats.llmMs, tChat))) : null,
        stats.toolMs > 0 ? h(React.Fragment, null,
          h('dt', null, tChat('stats.dialog.toolTime')),
          h('dd', null, formatDurationCompact(stats.toolMs, tChat))) : null,
        stats.ttftSteps > 0 ? h(React.Fragment, null,
          h('dt', null, tChat('stats.dialog.ttft')),
          h('dd', null, formatDurationCompact(stats.ttftMs / stats.ttftSteps, tChat))) : null,
        speed !== null ? h(React.Fragment, null,
          h('dt', null, tChat('stats.dialog.speed')),
          h('dd', null, speed)) : null))
    }

    function SubagentUsagePill({ usage, mode, tChat }) {
      const billedInput = usage
        ? (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)
        : 0
      const outTok = usage?.outputTokens || 0
      if (!usage || (billedInput === 0 && outTok === 0)) return null
      const cacheHit = formatCacheHitPercent(usage.cacheReadTokens || 0, billedInput, 0)
      const cacheHitText = cacheHit !== null ? tChat('stats.cacheHit', { percent: cacheHit }) : null
      const icon = h(DatabaseIcon)
      if (mode === 'compact') {
        return cacheHitText === null ? null : h(PlainStatPill, { stat: 'usage', icon, label: cacheHitText })
      }
      const total = billedInput + outTok
      const totalText = tChat('message.turnUsage.count', { count: formatTokensCompact(total, tChat) })
      const exactCount = v => tChat('message.turnUsage.count', { count: formatExactTokens(v, tChat) })
      const label = cacheHitText === null
        ? totalText
        : h(React.Fragment, null, totalText, h('span', { className: 'acpStatSep', 'aria-hidden': 'true' }, '·'), cacheHitText)

      return h(StatDialogPill, {
        stat: 'usage',
        icon,
        label,
        ariaLabel: cacheHitText === null ? totalText : `${totalText} · ${cacheHitText}`,
        title: tChat('stats.dialog.usageTitle'),
        titleValue: exactCount(total),
      },
      h('dl', { className: 'acpStatDetails', 'data-session-stats-usage': '' },
        cacheHit !== null ? h(React.Fragment, null,
          h('dt', null, tChat('message.turnUsage.cacheHit')),
          h('dd', null, `${cacheHit}%`)) : null,
        h('dt', null, tChat('message.turnUsage.input')),
        h('dd', null, exactCount(usage.uncachedInputTokens || 0)),
        h('dt', null, tChat('message.turnUsage.cacheRead')),
        h('dd', null, exactCount(usage.cacheReadTokens || 0)),
        usage.cacheWriteTokens ? h(React.Fragment, null,
          h('dt', null, tChat('message.turnUsage.cacheWrite')),
          h('dd', null, exactCount(usage.cacheWriteTokens))) : null,
        h('dt', null, tChat('message.turnUsage.output')),
        h('dd', null, exactCount(outTok))))
    }

    const CTX_RING_RADIUS = 5.5
    const CTX_RING_CIRCUMFERENCE = 2 * Math.PI * CTX_RING_RADIUS
    const CTX_READING_SLOT = '\u0000'
    const CTX_BREAKDOWN_ROWS = [
      { key: 'systemTokens', label: 'context.system', color: 'acpCtxColorSys' },
      { key: 'toolsTokens', label: 'context.tools', color: 'acpCtxColorTools' },
      { key: 'messageTokens', label: 'context.messages', color: 'acpCtxColorMsgs' },
    ]

    function SubagentContextMeter({ pressure, breakdown, tConv }) {
      const context = computeContextOccupancy(pressure)
      const available = context !== null
      const { open, setOpen, rootRef, panelRef, pos } = useAnchoredAboveDialog(available)

      if (!context) return null
      const percent = context.percent
      const reading = `${percent}%`
      const [headBefore = '', headAfter = ''] = tConv('context.aria', { percent: CTX_READING_SLOT })
        .split(CTX_READING_SLOT)
        .map(part => part.trim())

      const breakdownTotal = breakdown
        ? (breakdown.systemTokens || 0) + (breakdown.toolsTokens || 0) + (breakdown.messageTokens || 0)
        : 0
      const parts = !breakdown || breakdownTotal === 0
        ? [{ key: 'total', color: '', width: percent }]
        : CTX_BREAKDOWN_ROWS.map(row => ({
          key: row.key,
          color: row.color,
          width: (percent * (breakdown[row.key] || 0)) / breakdownTotal,
        }))
      const segments = parts.filter(p => p.width > 0)

      const dialogEl = open
        ? h('div', {
          ref: panelRef,
          className: 'acpCtxDialog',
          role: 'dialog',
          'aria-label': tConv('context.used'),
          style: pos || { visibility: 'hidden', left: 0, top: 0 },
        },
        h('div', { className: 'acpCtxHdr' },
          h('span', { className: 'acpCtxHeadline' }, headBefore),
          h('span', { className: 'acpCtxPercent' }, reading),
          h('span', { className: 'acpCtxHeadline' }, headAfter),
          h('span', { className: 'acpCtxFigures' },
            `~${formatTokensCompact(context.usedTokens, tConv)} / ${formatTokensCompact(context.contextWindow, tConv)}`)),
        h('div', { className: 'acpCtxBar' },
          ...segments.map(seg => h('div', {
            key: seg.key,
            className: seg.color ? `acpCtxSeg ${seg.color}` : 'acpCtxSeg',
            style: { width: `${seg.width}%` },
          }))),
        breakdown ? h('dl', { className: 'acpCtxRows' },
          ...CTX_BREAKDOWN_ROWS.map(row => h('div', { key: row.key, className: 'acpCtxRow' },
            h('dt', null,
              h('span', { className: `acpCtxSwatch ${row.color}`, 'aria-hidden': 'true' }),
              tConv(row.label)),
            h('dd', null, `~${formatTokensCompact(breakdown[row.key] || 0, tConv)}`)))) : null)
        : null

      return h('span', { ref: rootRef, className: 'acpCtxRoot', 'data-composer-stat': 'context' },
        h('button', {
          type: 'button',
          className: 'acpCtxTrigger',
          'aria-label': tConv('context.aria', { percent: reading }),
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          title: tConv('context.aria', { percent: reading }),
          onClick: () => setOpen(v => !v),
        },
        h('svg', { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': 'true' },
          h('circle', { className: 'acpCtxTrack', cx: 7, cy: 7, r: CTX_RING_RADIUS }),
          h('circle', {
            className: 'acpCtxFill',
            cx: 7,
            cy: 7,
            r: CTX_RING_RADIUS,
            strokeDasharray: `${(CTX_RING_CIRCUMFERENCE * percent) / 100} ${CTX_RING_CIRCUMFERENCE}`,
            transform: 'rotate(-90 7 7)',
          })),
        h('span', null, reading)),
        portalOrInline(dialogEl))
    }

    class DockErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { hasError: false }
      }
      static getDerivedStateFromError() {
        return { hasError: true }
      }
      componentDidCatch() {}
      render() {
        return this.state.hasError ? null : this.props.children
      }
    }

    function SubagentStatsDockInner({ useProjection, useChat, running = false, round = 1, startedAt = null }) {
      useExternalRevision(runtimeCtx?.locale)
      const mode = usePerformanceUsageMode()
      const projectedStats = typeof useProjection === 'function' ? useProjection('sessionStats') : undefined
      const settledNodes = typeof useChat === 'function' ? useChat(s => s?.legacy?.nodes) : undefined
      const tokenUsage = typeof useProjection === 'function' ? useProjection('tokenUsage') : undefined
      const contextPressure = typeof useProjection === 'function' ? useProjection('contextPressure') : undefined
      const contextBreakdown = typeof useProjection === 'function' ? useProjection('contextBreakdown') : undefined
      const timing = typeof useProjection === 'function' ? useProjection('subagentTiming') : undefined

      const stats = React.useMemo(
        () => projectedStats ?? deriveWindowStats(settledNodes),
        [projectedStats, settledNodes],
      )
      const tChat = makeTranslator('chat', FALLBACK_CHAT_ZH)
      const tConv = makeTranslator('conversation', FALLBACK_CONV_ZH)
      const liveRunning = Boolean(running || timing?.active?.since != null)
      const liveRound = Math.max(1, Number(round || 1))
      const showLiveActivity = mode !== 'off' && !(stats?.steps > 0) && liveRunning
      const hasContextOccupancy = computeContextOccupancy(contextPressure) !== null
      const liveContextWindow = Number(contextPressure?.contextWindow || 0)

      return h('div', { className: 'acpDock', 'data-composer-dock': '' },
        showLiveActivity
          ? h(PlainStatPill, {
            stat: 'activity',
            icon: h('span', { className: 'acpDockPulse', 'aria-hidden': 'true' }),
            label: `第 ${liveRound} 轮 · 执行中`,
          })
          : h(SubagentActivityPill, { stats, mode, tChat }),
        h(SubagentUsagePill, { usage: tokenUsage, mode, tChat }),
        hasContextOccupancy
          ? h(SubagentContextMeter, { pressure: contextPressure, breakdown: contextBreakdown, tConv })
          : (liveContextWindow > 0
            ? h(PlainStatPill, {
              stat: 'context',
              icon: h(DatabaseIcon),
              label: `上下文 ${formatTokensCompact(liveContextWindow, tConv)}`,
            })
            : null))
    }

    function SubagentStatsDock(props) {
      return h(DockErrorBoundary, null, h(SubagentStatsDockInner, props))
    }

    function NativeSubagentReadOnlyWithDock({ matched, useProjection, useChat }) {
      ensureStylesInjected()
      useExternalRevision(runtimeCtx?.locale)
      const tSub = makeTranslator('subagent', FALLBACK_SUBAGENT_ZH)
      const reason = matched?.reason || 'one-shot'
      const oneShot = reason === 'one-shot'
      return h('div', { className: 'acpInRoot' },
        h('div', { className: 'acpRoFrame', role: 'status' },
          h('strong', null, tSub(oneShot ? 'readonly.oneShot.title' : 'readonly.title')),
          h('span', null, tSub(
            reason === 'unknown'
              ? 'readonly.unknown.body'
              : oneShot
                ? 'readonly.oneShot.body'
                : 'readonly.body',
          ))),
        h(SubagentStatsDock, { useProjection, useChat, running: Boolean(matched?.running) }))
    }

    /* ---------------------------------------------------------------------- */
    /* Native-Identical ACP Subagent Composer (`InputBar` Capsule + Dock)     */
    /* ---------------------------------------------------------------------- */

    function SendArrowSvg() {
      return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' },
        h('path', {
          d: 'M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z',
          fill: 'currentColor',
        }))
    }

    function StopSquareSvg() {
      return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' },
        h('rect', { x: 3, y: 3, width: 10, height: 10, rx: 3, fill: 'currentColor' }))
    }

    function AcpSubagentComposer({ matched, useProjection, useChat, initialInfo = null }) {
      ensureStylesInjected()
      const childId = matched?.sessionId || ''
      const hostRunning = Boolean(matched?.running)
      const readInitialInfo = () => {
        if (initialInfo) return initialInfo
        const cached = childId ? sessionInfoCache.get(childId) || null : null
        if (!cached) return null
        return !hostRunning && cached.running ? { ...cached, running: false } : cached
      }
      const [info, setInfo] = React.useState(readInitialInfo)
      const [prevHostRunning, setPrevHostRunning] = React.useState(hostRunning)
      const prevChildIdRef = React.useRef(childId)
      const [stopping, setStopping] = React.useState(false)
      const [sending, setSending] = React.useState(false)
      const [promptText, setPromptText] = React.useState('')
      const [notifyParent, setNotifyParent] = React.useState(false)
      const [err, setErr] = React.useState('')
      const textareaRef = React.useRef(null)
      const subagentDesc = typeof useProjection === 'function' ? useProjection('subagent') : undefined

      React.useEffect(() => {
        if (prevChildIdRef.current !== childId) {
          prevChildIdRef.current = childId
          setInfo(readInitialInfo())
        }
      }, [childId, initialInfo, hostRunning])

      if (prevHostRunning !== hostRunning) {
        setPrevHostRunning(hostRunning)
        if (prevHostRunning && !hostRunning && info?.running) {
          setInfo({ ...info, running: false })
        }
      }

      React.useEffect(() => {
        if (!hostRunning && childId && sessionInfoCache.get(childId)?.running) {
          seedSessionInfoCache(childId, { running: false })
        }
      }, [childId, hostRunning])

      const refreshInfo = React.useCallback(async () => {
        if (!childId || typeof fetch !== 'function') return
        try {
          const res = await request(`${API_SESSION}?childId=${encodeURIComponent(childId)}`)
          const next = res.session || null
          if (next) seedSessionInfoCache(childId, next)
          setInfo(next)
        } catch {}
      }, [childId])

      React.useEffect(() => {
        void refreshInfo()
      }, [refreshInfo, hostRunning])

      const isRunning = hostRunning || (prevHostRunning && !hostRunning ? false : Boolean(info?.running))

      React.useEffect(() => {
        if (!isRunning) {
          setStopping(false)
          return undefined
        }
        const timer = setInterval(() => { void refreshInfo() }, 2000)
        return () => clearInterval(timer)
      }, [isRunning, refreshInfo])

      const handleStop = React.useCallback(async () => {
        if (!childId || stopping) return
        setStopping(true)
        setErr('')
        try {
          await request(API_CANCEL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ childId }),
          })
          await refreshInfo()
        } catch (e) {
          setErr(String(e?.message ?? e))
          setStopping(false)
        }
      }, [childId, stopping, refreshInfo])

      React.useEffect(() => {
        if (!isRunning || typeof window === 'undefined') return undefined
        const onKeyDown = (e) => {
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault()
            void handleStop()
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [isRunning, handleStop])

      React.useEffect(() => {
        const el = textareaRef.current
        if (!el || !el.style) return
        el.style.height = 'auto'
        const maxH = 240
        el.style.height = `${Math.min(Math.max(el.scrollHeight || 36, 36), maxH)}px`
      }, [promptText, isRunning])

      const handleSend = async (e) => {
        if (e) e.preventDefault()
        const clean = promptText.trim()
        if (!clean || sending || isRunning) return
        setSending(true)
        setErr('')
        try {
          await request(API_FOLLOWUP, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ childId, prompt: clean, notifyParent }),
          })
          setPromptText('')
          await refreshInfo()
        } catch (sendErr) {
          setErr(String(sendErr?.message ?? sendErr))
        } finally {
          setSending(false)
        }
      }

      const label = info?.label || subagentDesc?.label || 'ACP 子智能体'
      const agentId = info?.agentId || ''
      const round = info?.round || 1
      const isReadOnly = !isRunning && Boolean(info) && (info.allowResume === false || !info.canResume)

      if (isReadOnly) {
        return h('div', { className: 'acpInRoot' },
          h('div', { className: 'acpRoFrame', role: 'status' },
            h('strong', null, info.allowResume === false
              ? `${label} · 独立子会话已完成`
              : `${label} 子会话已结束`),
            h('span', null, info.allowResume === false
              ? '已在配置中关闭「同子会话续接」，每次委派均保持独立干净上下文。'
              : '该外部 ACP 智能体未声明会话恢复能力，请在主会话发起新委派。')),
          h(SubagentStatsDock, { useProjection, useChat, running: isRunning, round, startedAt: info?.startedAt ?? null }))
      }

      const inputDisabled = isRunning || sending
      const placeholderText = isRunning
        ? `${label} 正在执行第 ${round} 轮…（按 Esc 或点击右侧按钮停止）`
        : `继续向 ${label} 发消息，Enter 发送，Shift+Enter 换行`
      const modelSummary = info?.model ? formatModelDisplay(info.model) : ''

      const onCardMouseDown = (e) => {
        if (inputDisabled || e.button !== 0 || e.defaultPrevented) return
        const target = e.target
        if (!target || typeof target.closest !== 'function') return
        if (target.closest('button, a, input, select, textarea, [role="button"]')) return
        e.preventDefault()
        textareaRef.current?.focus?.()
      }

      return h('div', { className: 'acpInRoot' },
        err ? h('div', { className: 'acpInNotice', role: 'alert' }, err) : null,
        h('form', {
          className: 'acpInCard',
          'data-composer-card': '',
          onSubmit: handleSend,
          onMouseDown: onCardMouseDown,
        },
        h('div', { className: 'acpInScroll' },
          h('textarea', {
            ref: textareaRef,
            rows: 1,
            className: 'acpInTextarea' + (inputDisabled ? ' acpInTextareaDisabled' : ''),
            value: promptText,
            disabled: inputDisabled,
            placeholder: placeholderText,
            'aria-label': placeholderText,
            onChange: e => setPromptText(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
                e.preventDefault()
                void handleSend()
              }
            },
          })),
        h('div', { className: 'acpInRow' },
          h('div', { className: 'acpInTools' },
            h('span', { className: 'acpInAgentBadge' },
              agentId
                ? h('span', { className: 'acpInAgentIcon', 'aria-hidden': 'true' },
                  h('img', { src: `/api/acp-hub.icon?id=${encodeURIComponent(agentId)}`, alt: '' }))
                : (isRunning ? h('span', { className: 'acpAgentPulse', 'aria-hidden': 'true' }) : null),
              h('span', null, label),
              h('span', { className: 'acpInRoundTag' }, `R${isRunning ? round : round + 1}`)),
            h('button', {
              type: 'button',
              className: 'acpInChip' + (notifyParent ? ' acpInChipActive' : ''),
              'aria-pressed': notifyParent,
              disabled: sending,
              onMouseDown: e => e.preventDefault(),
              onClick: () => setNotifyParent(v => !v),
              title: '开启后，本轮手动追问结束时同步向父会话投递完成通知',
            },
            h('span', {
              className: 'acpHubDot' + (notifyParent ? '' : ' acpHubDotMuted'),
              style: notifyParent ? { background: 'currentColor' } : undefined,
              'aria-hidden': 'true',
            }),
            '通知主会话')),
          h('div', { className: 'acpInTrailing' },
            modelSummary
              ? h('span', { className: 'acpInModelCap', title: info?.model || modelSummary }, modelSummary)
              : null,
            isRunning
              ? h('button', {
                type: 'button',
                className: 'acpInPrimary',
                disabled: stopping,
                'aria-label': '停止生成',
                title: '停止生成 (Esc)',
                onClick: handleStop,
              }, h(StopSquareSvg))
              : h('button', {
                type: 'submit',
                className: 'acpInPrimary',
                disabled: sending || !promptText.trim(),
                'aria-label': '发送消息',
                title: '发送消息 (Enter)',
                onMouseDown: e => e.preventDefault(),
              }, h(SendArrowSvg))))),
        h(SubagentStatsDock, { useProjection, useChat, running: isRunning, round, startedAt: info?.startedAt ?? null }))
    }

    /* ---------------------------------------------------------------------- */
    /* Parent Chat Delegation Card (`tool.call.toolview`)                     */
    /* ---------------------------------------------------------------------- */

    function readCallArgs(block) {
      if (!block) return {}
      try {
        if (typeof block.args === 'function') return block.args() || {}
        if (block.args && typeof block.args === 'object') return block.args
      } catch {}
      return {}
    }

    function AcpAgentCall({ toolName, phase, block, useSessions, useSessionStatus }) {
      ensureStylesInjected()
      const meta = phase === 'result' && block?.meta && typeof block.meta === 'object' ? block.meta : {}
      const callArgs = readCallArgs(block)
      const agentId = String(
        meta.agent || (toolName === 'delegate_acp' ? callArgs.agent : toolName) || 'acp',
      ).toLowerCase()
      const label = typeof meta.label === 'string' && meta.label
        ? meta.label
        : (agentId === 'zcode' ? 'ZCode' : agentId === 'minimax' ? 'MiniMax Code' : agentId.toUpperCase())
      const model = typeof meta.model === 'string' ? meta.model : ''
      const childId = typeof meta.childId === 'string' ? meta.childId : ''
      const parentSessionId = typeof meta.parentSessionId === 'string' ? meta.parentSessionId : ''
      const startedAt = typeof meta.startedAt === 'number' ? meta.startedAt : undefined
      const round = typeof meta.round === 'number' ? meta.round : (callArgs.resumeChildId ? 2 : 1)

      const workspace = runtimeCtx?.get?.('uiWorkspace')
      const sessions = runtimeCtx?.get?.('sessions')
      const open = childId && parentSessionId && workspace?.openSession
        ? () => {
          try {
            seedSessionInfoCache(childId, {
              childId,
              agentId,
              label,
              model,
              round,
              running,
              startedAt,
              parentSessionId,
            })
            workspace.openSession({
              parentSessionId,
              childSessionId: childId,
              mode: 'one-shot',
            })
          } catch {}
        }
        : undefined

      const summary = useSessions ? useSessions(state => (childId ? state.byId[childId] : undefined)) : undefined
      const status = useSessionStatus ? useSessionStatus(value => (childId ? value.get(childId) : undefined)) : undefined
      const running = status?.running ?? summary?.running ?? false
      const timing = summary?.projectionValues?.subagentTiming
      const [stopping, setStopping] = React.useState(false)

      React.useEffect(() => {
        if (!childId || !sessions?.refreshProjections) return undefined
        void sessions.refreshProjections(childId).catch(() => {})
        return undefined
      }, [childId, sessions])

      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (!running) return undefined
        const timer = setInterval(() => { setNow(Date.now()) }, 1000)
        return () => { clearInterval(timer) }
      }, [running])

      let elapsed = 0
      if (timing && typeof timing.settledMs === 'number') {
        elapsed = timing.settledMs
        if (running && timing.active && typeof timing.active.since === 'number') {
          elapsed += Math.max(0, now - timing.active.since)
        }
      }
      if (elapsed <= 0 && startedAt !== undefined) {
        if (running) {
          elapsed = Math.max(0, Math.max(now, startedAt) - startedAt)
        } else if (summary?.updatedAt !== undefined && summary.updatedAt >= startedAt) {
          elapsed = summary.updatedAt - startedAt
        }
      }
      const duration = elapsed > 0 ? formatAcpDuration(elapsed) : ''
      const phaseBadge = phase === 'preparing'
        ? '正在启动 ACP'
        : phase === 'start'
          ? '正在建立子会话'
          : (round > 1 ? `同会话续派 R${round}` : '已委派')
      const activity = running ? '运行中' : summary ? '已完成' : '已委派'

      const onStop = async (e) => {
        e.stopPropagation()
        if (!childId || stopping) return
        setStopping(true)
        try {
          await request(API_CANCEL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ childId }),
          })
        } catch {} finally {
          setStopping(false)
        }
      }

      return h('div', { className: 'acpAgentCallWrap' },
        h(open ? 'button' : 'div', {
          className: 'acpAgentCall',
          ...(open ? { type: 'button', onClick: open, title: `点击打开 ${label} 实时子会话` } : {}),
        },
        h('span', { className: 'acpAgentMark', 'aria-hidden': 'true' },
          h('img', { src: `/api/acp-hub.icon?id=${encodeURIComponent(agentId)}`, alt: '' })),
        h('span', { className: 'acpAgentCopy' },
          h('span', { className: 'acpAgentName' },
            label,
            h('span', { className: 'acpAgentBadge' }, phaseBadge)),
          h('span', { className: 'acpAgentMeta' },
            model
              ? `${formatModelDisplay(model)}${childId ? ` · ${childId.slice(0, 22)}` : ''}`
              : (childId ? childId.slice(0, 30) : `@${agentId}`))),
        h('span', { className: 'acpAgentRight' },
          h('span', { className: 'acpAgentStatCol' },
            h('span', { className: 'acpAgentStatus' + (running ? ' running' : '') },
              running ? h('span', { className: 'acpAgentPulse', 'aria-hidden': 'true' }) : null,
              activity),
            duration ? h('span', { className: 'acpAgentDuration' }, `累计 ${duration}`) : null),
          running && childId
            ? h('button', {
              type: 'button',
              className: 'acpAgentStopBtn',
              disabled: stopping,
              onClick: onStop,
              title: '中止该 ACP 子进程',
            }, stopping ? '停止中' : '停止')
            : null)))
    }

    /* ---------------------------------------------------------------------- */
    /* Linked Model, Raw Reasoning & Native Permission Selectors              */
    /* ---------------------------------------------------------------------- */

    function resolveReasoningForModel(catalog, modelValue) {
      if (!catalog) return { options: [], defaultVal: '', explicitlyUnsupported: false }
      const effective = modelValue || catalog.current || ''
      const modelMeta = (catalog.models || []).find(m => m.value === effective)
      if (modelMeta && Array.isArray(modelMeta.effortOptions)) {
        return {
          options: modelMeta.effortOptions,
          defaultVal: modelMeta.defaultEffort || modelMeta.effortOptions[0]?.value || '',
          explicitlyUnsupported: modelMeta.effortOptions.length === 0,
        }
      }
      const opts = Array.isArray(catalog.reasoning) ? catalog.reasoning : []
      return {
        options: opts,
        defaultVal: catalog.reasoningCurrent || '',
        explicitlyUnsupported: false,
      }
    }

    function ModelSelect({ catalog, value, onChange, defaultOpen = false, initialActiveGroup = '' }) {
      const options = catalog?.models || []
      if (catalog?.loading && options.length === 0) {
        return h(HubSelect, {
          value: '',
          disabled: true,
          options: [{ value: '', label: '正在握手读取客户端模型列表…' }],
          onChange: () => {},
        })
      }
      if (options.length === 0) {
        return h('input', {
          className: 'acpHubInput acpHubMono',
          value: value || '',
          placeholder: '留空使用客户端默认模型，或输入模型 ID',
          onChange: e => onChange(e.target.value),
        })
      }
      const selectOpts = [
        {
          value: '',
          label: catalog?.current
            ? `跟随客户端默认 (${formatModelDisplay(catalog.current, catalog)})`
            : '跟随客户端默认模型',
        },
        ...options.map(opt => ({
          value: opt.value,
          label: opt.name || opt.value,
        })),
      ]
      return h(HubSelect, {
        value: value || '',
        options: selectOpts,
        onChange,
        groupBySlash: true,
        cascadeGroups: true,
        defaultOpen,
        initialActiveGroup,
        searchable: true,
        searchPlaceholder: '搜索供应商渠道或模型名称…',
        allowCustom: true,
        customPlaceholder: '留空跟随客户端默认，或手动输入模型 ID',
      })
    }

    function ReasoningSelect({ catalog, modelValue, value, onChange }) {
      const { options, defaultVal, explicitlyUnsupported } = resolveReasoningForModel(catalog, modelValue)

      if (catalog?.loading && options.length === 0) {
        return h(HubSelect, {
          value: '',
          disabled: true,
          options: [{ value: '', label: '正在联动读取模型推理档位…' }],
          onChange: () => {},
        })
      }

      if (explicitlyUnsupported) {
        return h(HubSelect, {
          value: value || '',
          disabled: !value,
          options: [{ value: '', label: '当前模型无推理档位参数' }],
          onChange,
          allowCustom: true,
          mono: true,
          customPlaceholder: '手动输入推理档位参数（可选）',
        })
      }

      if (options.length === 0) {
        return h('input', {
          className: 'acpHubInput acpHubMono',
          value: value || '',
          placeholder: '留空跟随模型默认（例如 low / medium / high / max）',
          onChange: e => onChange(e.target.value),
        })
      }

      // Raw original values only — no translation
      const selectOpts = [
        {
          value: '',
          label: defaultVal ? `跟随默认 (${defaultVal})` : '跟随默认',
          mono: false,
        },
        ...options.map(opt => ({
          value: opt.value,
          label: opt.value,
          mono: true,
        })),
      ]

      return h(HubSelect, {
        value: value || '',
        options: selectOpts,
        onChange,
        searchable: false,
        allowCustom: true,
        mono: Boolean(value),
        customPlaceholder: '手动输入原始推理档位（例如 high / xhigh / max）',
      })
    }

    function PermissionModeSelect({ catalog, modeValue, fallbackPermission, onModeChange, onFallbackChange }) {
      const pm = catalog?.permissionModes
      const options = Array.isArray(pm?.options) ? pm.options : []

      if (catalog?.loading && options.length === 0) {
        return h(HubSelect, {
          value: '',
          disabled: true,
          options: [{ value: '', label: '正在读取客户端自身权限列表…' }],
          onChange: () => {},
        })
      }

      if (options.length > 0) {
        const defaultOpt = options.find(o => o.value === pm.current)
        const defaultLabel = defaultOpt ? (defaultOpt.name || defaultOpt.value) : (pm.current || '默认')
        const selectOpts = [
          {
            value: '',
            label: `跟随客户端默认 (${defaultLabel})`,
            code: pm.current || '',
          },
          ...options.map(opt => ({
            value: opt.value,
            label: opt.name || opt.value,
            code: opt.name && opt.name !== opt.value ? opt.value : '',
            description: opt.description || '',
          })),
        ]

        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px' } },
          h(HubSelect, {
            value: modeValue || '',
            options: selectOpts,
            onChange: nextVal => onModeChange(nextVal, pm.source, pm.configId),
            searchable: false,
          }),
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
            h('span', { className: 'acpHubHint' }, '临时确认请求（request_permission）兜底应答：'),
            h(HubSelect, {
              compact: true,
              value: fallbackPermission || 'allow',
              searchable: false,
              options: [
                { value: 'allow', label: '后台自动放行', code: 'allow' },
                { value: 'reject', label: '安全拒绝', code: 'reject' },
              ],
              onChange: onFallbackChange,
            })))
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
        h(HubSelect, {
          value: fallbackPermission || 'allow',
          searchable: false,
          options: [
            { value: 'allow', label: '自动批准', code: 'allow_once / allow_always', description: '后台委派免卡死放行工具调用' },
            { value: 'reject', label: '默认拒绝', code: 'reject', description: '遇到需审批动作立即拒绝' },
          ],
          onChange: onFallbackChange,
        }),
        h('div', { className: 'acpHubHint' }, '该客户端未通过 ACP 广播模式列表，使用 request_permission 应答策略。'))
    }

    /* ---------------------------------------------------------------------- */
    /* Add Agent View                                                         */
    /* ---------------------------------------------------------------------- */

    function AddAgentView({ presets, onQuickAdd, onCreateCustom, onCancel, busy }) {
      const [id, setId] = React.useState('')
      const [name, setName] = React.useState('')
      const [commandLine, setCommandLine] = React.useState('')
      const [permission, setPermission] = React.useState('allow')
      const [whenToUse, setWhenToUse] = React.useState('')
      const [err, setErr] = React.useState('')

      const submitCustom = (e) => {
        e.preventDefault()
        const cleanId = id.trim().toLowerCase()
        if (!AGENT_ID_RE.test(cleanId)) {
          setErr('ID 必须以小写字母开头，仅含小写字母、数字或连字符（2–32 位）')
          return
        }
        const parsed = parseCommandLine(commandLine)
        if (!parsed.command.trim()) {
          setErr('请填写有效的启动命令行（例如 /usr/local/bin/my-agent --acp）')
          return
        }
        setErr('')
        onCreateCustom({
          id: cleanId,
          name: name.trim() || cleanId,
          command: parsed.command,
          args: parsed.args,
          permission,
          whenToUse: whenToUse.trim(),
          enabled: true,
          autoLaunch: true,
          allowResume: true,
        })
      }

      return h('div', { className: 'acpHubBody' },
        h('div', { className: 'acpHubContainer' },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' } },
            h('div', null,
              h('h2', { style: { margin: 0, fontSize: '16px', fontWeight: 650 } }, '添加外部 ACP 智能体'),
              h('p', { className: 'acpHubSectionDesc' }, '从已检测到的本机预设一键添加，或在下方接入任意支持 Agent Client Protocol 的命令。')),
            onCancel ? h('button', { type: 'button', className: 'acpHubBtn', onClick: onCancel }, '返回详情') : null),

          err ? h('div', { className: 'acpHubAlertErr' }, err) : null,

          h('div', { className: 'acpHubSection' },
            h('div', { className: 'acpHubSectionHead' },
              h('div', null,
                h('h3', { className: 'acpHubSectionTitle' }, '本机常用 ACP 智能体预设'),
                h('p', { className: 'acpHubSectionDesc' }, '自动扫描 PATH、~/.nvm、~/.minimax-code、~/.opencode 与 Homebrew 路径。'))),
            h('div', { className: 'acpHubPresetGrid' },
              ...(presets || []).map(preset => h('div', { key: preset.id, className: 'acpHubPresetCard' },
                h('div', null,
                  h('div', { className: 'acpHubPresetTop' },
                    h('span', { className: 'acpHubAvatar' },
                      h('img', { src: `/api/acp-hub.icon?id=${encodeURIComponent(preset.id)}`, alt: '' })),
                    h('div', { style: { minWidth: 0, flex: 1 } },
                      h('div', { style: { fontWeight: 650, fontSize: '13px' } }, preset.name),
                      h('div', { className: 'acpHubRowId' }, `@${preset.id}`)),
                    h('span', { className: 'acpHubPill ' + (preset.installed ? 'acpHubPillOk' : '') },
                      preset.installed ? '已安装' : '未检出')),
                  h('div', { style: { marginTop: '8px', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' } },
                    preset.whenToUse),
                  h('div', { className: 'acpHubHint acpHubMono', style: { marginTop: '6px', wordBreak: 'break-all' } },
                    preset.commandLine || formatCommandLine(preset.command, preset.args))),
                h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
                  preset.alreadyAdded
                    ? h('span', { className: 'acpHubPill' }, '已在列表中')
                    : h('button', {
                      type: 'button',
                      className: 'acpHubBtn acpHubBtnSm ' + (preset.installed ? 'acpHubBtnPrimary' : ''),
                      disabled: busy,
                      onClick: () => onQuickAdd(preset),
                    }, preset.installed ? '一键启用' : '仍要添加')))))),

          h('form', { className: 'acpHubSection', onSubmit: submitCustom },
            h('div', { className: 'acpHubSectionHead' },
              h('div', null,
                h('h3', { className: 'acpHubSectionTitle' }, '自定义 ACP 命令'),
                h('p', { className: 'acpHubSectionDesc' }, '添加后无需重启 DSH，立即生成同名斜杠命令与 delegate_acp 路由。'))),
            h('div', { className: 'acpHubGrid' },
              h('div', { className: 'acpHubField' },
                h('label', { className: 'acpHubLabel' }, '智能体 ID（工具与 /命令名）'),
                h('input', {
                  className: 'acpHubInput acpHubMono',
                  placeholder: '例如 my-acp-agent',
                  value: id,
                  onChange: e => setId(e.target.value),
                })),
              h('div', { className: 'acpHubField' },
                h('label', { className: 'acpHubLabel' }, '显示名称'),
                h('input', {
                  className: 'acpHubInput',
                  placeholder: '例如 My ACP Agent',
                  value: name,
                  onChange: e => setName(e.target.value),
                })),
              h('div', { className: 'acpHubField acpHubFieldFull' },
                h('label', { className: 'acpHubLabel' }, '启动命令行（Command Line）'),
                h('input', {
                  className: 'acpHubInput acpHubMono',
                  placeholder: '例如 /usr/local/bin/my-agent --acp（独立 ACP 桥接程序如 zcode-acp 无需参数）',
                  value: commandLine,
                  onChange: e => setCommandLine(e.target.value),
                })),
              h('div', { className: 'acpHubField' },
                h('label', { className: 'acpHubLabel' }, '默认审批兜底策略'),
                h(HubSelect, {
                  value: permission,
                  searchable: false,
                  options: [
                    { value: 'allow', label: '自动批准', code: 'allow' },
                    { value: 'reject', label: '默认拒绝', code: 'reject' },
                  ],
                  onChange: setPermission,
                })),
              h('div', { className: 'acpHubField acpHubFieldFull' },
                h('label', { className: 'acpHubLabel' }, '适用场景说明（供主模型自动路由参考）'),
                h('input', {
                  className: 'acpHubInput',
                  placeholder: '例如：需要独立前端视觉审查或特定语言重构时使用。',
                  value: whenToUse,
                  onChange: e => setWhenToUse(e.target.value),
                }))),
            h('div', { style: { marginTop: '14px', display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
              h('button', { type: 'submit', className: 'acpHubBtn acpHubBtnPrimary', disabled: busy }, '创建并启用')))))
    }

    /* ---------------------------------------------------------------------- */
    /* Side-by-Side Native MCP & Skills Inspector + Segmented Filter Pills    */
    /* ---------------------------------------------------------------------- */

    function NativeInspectorTab({
      agent,
      inspection,
      onRefresh,
      initialMcpTab = 'enabled',
      initialSkillTab = 'enabled',
      initialSkillFilter = '',
    }) {
      const [skillFilter, setSkillFilter] = React.useState(initialSkillFilter)
      const [mcpTab, setMcpTab] = React.useState(initialMcpTab)
      const [skillTab, setSkillTab] = React.useState(initialSkillTab)
      const [jumpMsg, setJumpMsg] = React.useState('')
      const [jumpErr, setJumpErr] = React.useState('')

      React.useEffect(() => {
        setMcpTab(initialMcpTab || 'enabled')
        setSkillTab(initialSkillTab || 'enabled')
        setSkillFilter(initialSkillFilter || '')
        setJumpMsg('')
        setJumpErr('')
      }, [agent?.id])

      const openSource = async (action, targetPath, labelText) => {
        setJumpErr('')
        setJumpMsg('')
        try {
          const res = await request(API_OPEN_SOURCE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: agent.id, action, targetPath }),
          })
          setJumpMsg(`已通过 ${res.via || '系统'} 打开 ${labelText || res.opened}`)
        } catch (e) {
          setJumpErr(String(e?.message ?? e))
        }
      }

      if (!inspection || inspection.loading) {
        return h('div', { className: 'acpHubSection' },
          h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' } }, '正在实时扫描客户端真源 MCP 与 Skills 配置…'))
      }
      if (inspection.error) {
        return h('div', { className: 'acpHubAlertErr' }, inspection.error)
      }

      const mcpServers = inspection.mcpServers || []
      const enabledMcps = mcpServers.filter(s => s.enabled !== false)
      const disabledMcps = mcpServers.filter(s => s.enabled === false)
      const effectiveMcpTab = mcpTab === 'disabled' && disabledMcps.length > 0 ? 'disabled' : 'enabled'
      const visibleMcps = effectiveMcpTab === 'disabled' ? disabledMcps : enabledMcps
      const mcpConfigFiles = inspection.mcpConfigFiles || []
      const primaryMcpCfg = mcpConfigFiles[0] || null

      const skillDirectories = inspection.skillDirectories || []
      const primarySkillDir = skillDirectories.find(d => d.exists) || skillDirectories[0] || null
      const skills = inspection.skills || []
      const q = skillFilter.trim().toLowerCase()
      const filteredSkills = q
        ? skills.filter(s =>
          s.name.toLowerCase().includes(q)
          || (s.description || '').toLowerCase().includes(q)
          || (s.scope || '').toLowerCase().includes(q)
          || (s.pluginName || '').toLowerCase().includes(q))
        : skills
      const enabledSkills = filteredSkills.filter(s => s.enabled !== false)
      const disabledSkills = filteredSkills.filter(s => s.enabled === false)
      const effectiveSkillTab = skillTab === 'disabled' && disabledSkills.length > 0 ? 'disabled' : 'enabled'
      const visibleSkills = effectiveSkillTab === 'disabled' ? disabledSkills : enabledSkills

      const originLabel = (skill) => {
        if (skill.origin === 'plugin') return skill.pluginName ? `插件 · ${skill.pluginName}` : '官方插件'
        if (skill.origin === 'agents-shared') return '通用目录 (~/.agents)'
        if (skill.origin === 'builtin') return '客户端内置'
        return '个人技能'
      }

      const renderMcpRow = (srv) => h('div', {
        key: `${srv.source}:${srv.name}`,
        className: 'acpInspRow' + (srv.enabled === false ? ' acpInspRowMuted' : ''),
      },
      h('div', { className: 'acpInspRowLeft' },
        h('div', { className: 'acpInspRowTitleLine' },
          h('span', { className: 'acpHubDot' + (srv.enabled === false ? ' acpHubDotMuted' : '') }),
          h('span', { className: 'acpInspRowName' }, srv.name),
          h('span', { className: 'acpHubPill ' + (srv.transport === 'magpie-hub' ? 'acpHubPillBrand' : '') },
            srv.transport === 'magpie-hub' ? 'Magpie Hub' : srv.transport),
          srv.enabled === false ? h('span', { className: 'acpHubPill' }, '未启用') : null),
        srv.summary
          ? h('div', { className: 'acpInspRowDesc acpHubMono' }, srv.summary)
          : (srv.description ? h('div', { className: 'acpInspRowDesc' }, srv.description) : null)),
      h('div', { className: 'acpInspRowActions' },
        srv.transport === 'magpie-hub' && inspection.hubs?.magpieApp
          ? h('button', {
            type: 'button',
            className: 'acpHubBtn acpHubBtnXs',
            onClick: () => void openSource('magpie-app', inspection.hubs.magpieApp.path, 'Magpie'),
          }, '打开 Magpie ↗')
          : null,
        srv.sourcePath
          ? h('button', {
            type: 'button',
            className: 'acpHubBtn acpHubBtnXs',
            onClick: () => void openSource('edit', srv.sourcePath, srv.source),
            title: `打开真源配置文件 ${srv.source}`,
          }, srv.enabled === false ? '去真源开启' : '配置')
          : null))

      const renderSkillRow = (skill) => h('div', {
        key: `${skill.scope}:${skill.name}`,
        className: 'acpInspRow' + (skill.enabled === false ? ' acpInspRowMuted' : ''),
      },
      h('div', { className: 'acpInspRowLeft' },
        h('div', { className: 'acpInspRowTitleLine' },
          h('span', { className: 'acpHubDot' + (skill.enabled === false ? ' acpHubDotMuted' : '') }),
          h('span', { className: 'acpInspRowName acpHubMono' }, skill.name),
          h('span', { className: 'acpHubPill ' + (skill.origin === 'plugin' ? 'acpHubPillBrand' : '') },
            originLabel(skill)),
          skill.enabled === false ? h('span', { className: 'acpHubPill' }, '未启用') : null),
        skill.description ? h('div', { className: 'acpInspRowDesc' }, skill.description) : null),
      h('div', { className: 'acpInspRowActions' },
        skill.skillMdPath
          ? h('button', {
            type: 'button',
            className: 'acpHubBtn acpHubBtnXs',
            onClick: () => void openSource('edit', skill.skillMdPath, `${skill.name}/SKILL.md`),
          }, 'SKILL.md')
          : null,
        skill.dirPath
          ? h('button', {
            type: 'button',
            className: 'acpHubBtn acpHubBtnXs',
            onClick: () => void openSource('reveal', skill.dirPath, skill.name),
          }, 'Finder')
          : null))

      return h('div', null,
        jumpErr ? h('div', { className: 'acpHubAlertErr' }, jumpErr) : null,

        h('div', { className: 'acpHubNotice' },
          h('div', { style: { flex: '1 1 320px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '2px' } },
              h('strong', { style: { color: 'var(--dsw-alias-label-primary)' } }, '单真源透明透视 · 一键直达真源设置'),
              jumpMsg ? h('span', { className: 'acpHubNoteOk' }, jumpMsg) : null),
            h('div', null,
              '仅展示该客户端真实生效的真源 MCP 与 Skills（点击卡片顶部「已启用 / 未启用」胶囊即可切换查看，凭据已脱敏）。')),
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
            inspection.clientApp
              ? h('button', {
                type: 'button',
                className: 'acpHubBtn acpHubBtnSm acpHubBtnPrimary',
                onClick: () => void openSource('app', inspection.clientApp.path, `${inspection.clientApp.name} 客户端`),
              }, `打开 ${inspection.clientApp.name} 客户端 ↗`)
              : null,
            inspection.hubs?.magpieApp
              ? h('button', {
                type: 'button',
                className: 'acpHubBtn acpHubBtnSm',
                onClick: () => void openSource('magpie-app', inspection.hubs.magpieApp.path, 'Magpie'),
                title: inspection.hubs.magpieOnline ? '打开 Magpie 桌面应用（网关在线）' : '打开 Magpie 桌面应用',
              },
              h('span', { className: 'acpHubDot' + (inspection.hubs.magpieOnline ? '' : ' acpHubDotMuted') }),
              '打开 Magpie ↗')
              : null,
            inspection.hubs?.skillsHubOnline
              ? h('a', {
                className: 'acpHubBtn acpHubBtnSm',
                href: inspection.hubs.skillsHubUrl,
                target: '_blank',
                rel: 'noreferrer',
              }, h('span', { className: 'acpHubDot' }), 'Skills Hub ↗')
              : null,
            h('button', { type: 'button', className: 'acpHubBtn acpHubBtnSm', onClick: onRefresh }, '刷新'))),

        /* Two-Column Side-by-Side Split: Left = MCP, Right = Skills */
        h('div', { className: 'acpInspectorSplit' },
          /* Left Column: Native MCP */
          h('div', { className: 'acpInspCol' },
            h('div', { className: 'acpInspColHead' },
              h('div', { className: 'acpInspColTop' },
                h('div', { className: 'acpInspColTitleRow' },
                  h('h3', { className: 'acpHubSectionTitle' }, '原生 MCP 服务'),
                  h('div', { className: 'acpInspTabGroup', role: 'group', 'aria-label': 'MCP 状态筛选' },
                    h('button', {
                      type: 'button',
                      'data-insp-filter': 'mcp-enabled',
                      'aria-pressed': effectiveMcpTab === 'enabled',
                      className: 'acpInspTabPill' + (effectiveMcpTab === 'enabled' ? ' acpInspTabPillOkActive' : ''),
                      onClick: () => setMcpTab('enabled'),
                    }, `已启用 ${enabledMcps.length}`),
                    disabledMcps.length > 0
                      ? h('button', {
                        type: 'button',
                        'data-insp-filter': 'mcp-disabled',
                        'aria-pressed': effectiveMcpTab === 'disabled',
                        className: 'acpInspTabPill' + (effectiveMcpTab === 'disabled' ? ' acpInspTabPillMutedActive' : ''),
                        onClick: () => setMcpTab('disabled'),
                      }, `未启用 ${disabledMcps.length}`)
                      : null)),
                h('div', { style: { display: 'flex', gap: '5px' } },
                  primaryMcpCfg
                    ? h('button', {
                      type: 'button',
                      className: 'acpHubBtn acpHubBtnXs',
                      onClick: () => void openSource('edit', primaryMcpCfg.path, primaryMcpCfg.label),
                    }, primaryMcpCfg.exists ? '编辑配置' : '打开目录')
                    : null,
                  primaryMcpCfg?.exists
                    ? h('button', {
                      type: 'button',
                      className: 'acpHubBtn acpHubBtnXs',
                      onClick: () => void openSource('reveal', primaryMcpCfg.path, primaryMcpCfg.label),
                    }, 'Finder')
                    : null)),
              h('div', { className: 'acpHubHint acpHubMono' },
                primaryMcpCfg
                  ? `真源: ${primaryMcpCfg.label}${primaryMcpCfg.exists ? '' : '（未创建）'}`
                  : `未检测到 ${agent.name} 的本地 MCP 配置文件`)),

            h('div', { className: 'acpInspColBody' },
              visibleMcps.length === 0
                ? h('div', { className: 'acpHubHint', style: { padding: '8px 4px' } },
                  effectiveMcpTab === 'enabled' && disabledMcps.length > 0
                    ? h(React.Fragment, null,
                      '当前没有处于启用状态的原生 MCP 服务。',
                      h('button', {
                        type: 'button',
                        className: 'acpInspSwitchLink',
                        onClick: () => setMcpTab('disabled'),
                      }, `查看未启用 (${disabledMcps.length})`))
                    : '当前客户端未配置本地 MCP 服务。')
                : visibleMcps.map(renderMcpRow))),

          /* Right Column: Native Skills */
          h('div', { className: 'acpInspCol' },
            h('div', { className: 'acpInspColHead' },
              h('div', { className: 'acpInspColTop' },
                h('div', { className: 'acpInspColTitleRow' },
                  h('h3', { className: 'acpHubSectionTitle' }, '原生 Skills'),
                  h('div', { className: 'acpInspTabGroup', role: 'group', 'aria-label': 'Skills 状态筛选' },
                    h('button', {
                      type: 'button',
                      'data-insp-filter': 'skills-enabled',
                      'aria-pressed': effectiveSkillTab === 'enabled',
                      className: 'acpInspTabPill' + (effectiveSkillTab === 'enabled' ? ' acpInspTabPillOkActive' : ''),
                      onClick: () => setSkillTab('enabled'),
                    }, `已启用 ${enabledSkills.length}`),
                    disabledSkills.length > 0
                      ? h('button', {
                        type: 'button',
                        'data-insp-filter': 'skills-disabled',
                        'aria-pressed': effectiveSkillTab === 'disabled',
                        className: 'acpInspTabPill' + (effectiveSkillTab === 'disabled' ? ' acpInspTabPillMutedActive' : ''),
                        onClick: () => setSkillTab('disabled'),
                      }, `未启用 ${disabledSkills.length}`)
                      : null)),
                h('div', { style: { display: 'flex', gap: '5px', alignItems: 'center' } },
                  primarySkillDir
                    ? h('button', {
                      type: 'button',
                      className: 'acpHubBtn acpHubBtnXs',
                      onClick: () => void openSource('folder', primarySkillDir.path, primarySkillDir.label),
                    }, '打开目录')
                    : null)),
              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' } },
                h('span', { className: 'acpHubHint acpHubMono', style: { flex: '1 1 160px' } },
                  inspection.skillDirs?.length
                    ? `真源: ${inspection.skillDirs.join(' · ')}`
                    : '未发现本地技能目录'),
                skills.length > 5
                  ? h('input', {
                    className: 'acpHubSearch',
                    style: { width: '175px', height: '26px', fontSize: '11.5px' },
                    placeholder: '搜索 Skill 名称或描述…',
                    value: skillFilter,
                    onChange: e => setSkillFilter(e.target.value),
                  })
                  : null)),

            h('div', { className: 'acpInspColBody' },
              visibleSkills.length === 0
                ? h('div', { className: 'acpHubHint', style: { padding: '8px 4px' } },
                  effectiveSkillTab === 'enabled' && disabledSkills.length > 0
                    ? h(React.Fragment, null,
                      q ? `已启用中无匹配项，未启用中有 ${disabledSkills.length} 个匹配。` : '当前没有处于启用状态的真源 Skill。',
                      h('button', {
                        type: 'button',
                        className: 'acpInspSwitchLink',
                        onClick: () => setSkillTab('disabled'),
                      }, `切换到未启用 (${disabledSkills.length})`))
                    : (q ? '无匹配的真源 Skill。' : '未检测到本地真源 Skill。'))
                : visibleSkills.map(renderSkillRow)))))
    }

    /* ---------------------------------------------------------------------- */
    /* Main Settings Page                                                     */
    /* ---------------------------------------------------------------------- */

    function isTransportSupportedForAgent(cand, cat, family) {
      const wireType = cand?.wireType || (cand?.transport === 'stdio' ? 'stdio' : (cand?.transport === 'sse' ? 'sse' : 'http'))
      if (wireType === 'stdio') return true
      if (wireType === 'http') {
        return family === 'zcode' || !cat || cat.loading || cat.error || cat.capabilities?.mcpHttp !== false
      }
      if (wireType === 'sse') {
        return family === 'zcode' || !cat || cat.loading || cat.error || cat.capabilities?.mcpSse !== false
      }
      return false
    }

    function Page({ bus }) {
      const [agents, setAgents] = React.useState(null)
      const [promptBudget, setPromptBudget] = React.useState(null)
      const [activeRuns, setActiveRuns] = React.useState([])
      const [hostMcps, setHostMcps] = React.useState([])
      const [presets, setPresets] = React.useState([])
      const [selectedId, setSelectedId] = React.useState('')
      const [addingMode, setAddingMode] = React.useState(false)
      const [activeTab, setActiveTab] = React.useState('model')
      const [search, setSearch] = React.useState('')

      const [draft, setDraft] = React.useState(null)
      const [dirty, setDirty] = React.useState(false)
      const [advancedOpen, setAdvancedOpen] = React.useState(false)
      const lastSyncedAgentIdRef = React.useRef('')
      const [saving, setSaving] = React.useState(false)
      const [confirmDelete, setConfirmDelete] = React.useState(false)
      const [error, setError] = React.useState('')
      const [note, setNote] = React.useState('')

      const [catalogs, setCatalogs] = React.useState({})
      const [inspections, setInspections] = React.useState({})

      const loadCatalog = React.useCallback(async (agentId, force = false, targetModel = '') => {
        if (!agentId) return null
        setCatalogs(cur => ({ ...cur, [agentId]: { ...(cur[agentId] || {}), loading: true, error: '' } }))
        try {
          const qs = `?id=${encodeURIComponent(agentId)}${force ? '&refresh=1' : ''}${targetModel ? `&model=${encodeURIComponent(targetModel)}` : ''}`
          const res = await request(`${API_CATALOG}${qs}`)
          const nextCat = { loading: false, ...res.catalog }
          setCatalogs(cur => ({ ...cur, [agentId]: nextCat }))
          return nextCat
        } catch (err) {
          setCatalogs(cur => ({ ...cur, [agentId]: { ...(cur[agentId] || {}), loading: false, error: String(err?.message ?? err) } }))
          return null
        }
      }, [])

      const loadInspection = React.useCallback(async (agentId) => {
        if (!agentId) return
        setInspections(cur => ({ ...cur, [agentId]: { loading: true } }))
        try {
          const res = await request(`${API_INSPECT}?id=${encodeURIComponent(agentId)}`)
          setInspections(cur => ({ ...cur, [agentId]: { loading: false, ...res.inspection } }))
        } catch (err) {
          setInspections(cur => ({ ...cur, [agentId]: { loading: false, error: String(err?.message ?? err) } }))
        }
      }, [])

      const loadAll = React.useCallback(async (preferId) => {
        setError('')
        try {
          const [stateBody, presetsBody] = await Promise.all([
            request(API_STATE),
            request(API_PRESETS).catch(() => ({ presets: [] })),
          ])
          const list = stateBody.agents || []
          for (const item of list) ensureToolViewRegistered(item.id)
          setAgents(list)
          setPromptBudget(stateBody.promptBudget || null)
          setActiveRuns(stateBody.activeRuns || [])
          setHostMcps(stateBody.hostMcpCandidates || [])
          setPresets(presetsBody.presets || [])
          setSelectedId((prev) => {
            const target = preferId || prev
            if (target && list.some(a => a.id === target)) return target
            return list[0]?.id || ''
          })
        } catch (err) {
          setError(String(err?.message ?? err))
        }
      }, [])

      React.useEffect(() => { void loadAll() }, [loadAll])
      React.useEffect(() => (bus ? bus.subscribe(() => void loadAll()) : undefined), [bus, loadAll])

      const selectedAgent = React.useMemo(
        () => (agents || []).find(a => a.id === selectedId) || null,
        [agents, selectedId],
      )

      React.useEffect(() => {
        if (!selectedAgent) {
          lastSyncedAgentIdRef.current = ''
          setConfirmDelete(false)
          setNote('')
          setError('')
          setDraft(null)
          setDirty(false)
          setAdvancedOpen(false)
          return
        }
        const switched = lastSyncedAgentIdRef.current !== selectedAgent.id
        if (switched) {
          lastSyncedAgentIdRef.current = selectedAgent.id
          setConfirmDelete(false)
          setNote('')
          setError('')
          setDraft({
            ...selectedAgent,
            allowResume: selectedAgent.allowResume !== false,
            commandLine: selectedAgent.commandLine || formatCommandLine(selectedAgent.command, selectedAgent.args),
            envText: envToText(selectedAgent.env),
          })
          setDirty(false)
          setAdvancedOpen(!selectedAgent.ready)
          if (!catalogs[selectedAgent.id]) {
            void loadCatalog(selectedAgent.id, false, selectedAgent.model || '')
          }
          void loadInspection(selectedAgent.id)
        } else if (!selectedAgent.ready) {
          setAdvancedOpen(true)
        }
      }, [selectedId, selectedAgent?.id, selectedAgent?.ready])

      const patchDraft = (field, value) => {
        setDraft(cur => (cur ? { ...cur, [field]: value } : cur))
        setDirty(true)
        setNote('')
      }

      const handleModelChange = async (nextModel) => {
        if (!selectedAgent) return
        const currentCat = catalogs[selectedAgent.id]
        const preCheck = resolveReasoningForModel(currentCat, nextModel)
        const modelEntry = (currentCat?.models || []).find(m => m.value === nextModel)
        let activeCat = currentCat

        if (nextModel && currentCat && !Array.isArray(modelEntry?.effortOptions)) {
          const probed = await loadCatalog(selectedAgent.id, false, nextModel)
          if (probed) activeCat = probed
        }

        const linked = resolveReasoningForModel(activeCat, nextModel)
        setDraft((cur) => {
          if (!cur) return cur
          let nextReasoning = cur.reasoning || ''
          if (linked.explicitlyUnsupported) {
            nextReasoning = ''
          } else if (linked.options.length > 0 && nextReasoning && !linked.options.some(o => o.value === nextReasoning)) {
            nextReasoning = ''
          }
          return {
            ...cur,
            model: nextModel,
            reasoning: nextReasoning,
            reasoningConfigId: activeCat?.reasoningConfigId || cur.reasoningConfigId || '',
          }
        })
        setDirty(true)
        setNote(preCheck.options.length > 0 || activeCat ? '已根据所选模型同步原始推理档位。' : '')
      }

      const handleModeChange = (nextMode, modeSource, modeConfigId) => {
        setDraft(cur => (cur ? {
          ...cur,
          mode: nextMode,
          modeSource: modeSource || cur.modeSource || '',
          modeConfigId: modeConfigId || cur.modeConfigId || '',
        } : cur))
        setDirty(true)
        setNote('')
      }

      const handleDisclosureChange = async (nextMode) => {
        try {
          const res = await request(API_SAVE_SETTINGS, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ promptDisclosure: nextMode }),
          })
          setPromptBudget(res.promptBudget || null)
          setNote('提示词披露策略已即时更新（下一轮主会话请求生效）。')
        } catch (err) {
          setError(String(err?.message ?? err))
        }
      }

      const toggleForwardMcp = (mcpId) => {
        setDraft((cur) => {
          if (!cur) return cur
          const set = new Set(cur.forwardMcpIds || [])
          if (set.has(mcpId)) set.delete(mcpId)
          else set.add(mcpId)
          return { ...cur, forwardMcpIds: Array.from(set) }
        })
        setDirty(true)
        setNote('')
      }

      const handleQuickToggle = async (agentId, enabled) => {
        try {
          const res = await request(API_TOGGLE_AGENT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: agentId, enabled }),
          })
          setAgents(cur => (cur || []).map(a => (a.id === agentId ? { ...a, enabled } : a)))
          if (res.promptBudget) setPromptBudget(res.promptBudget)
          if (draft && draft.id === agentId) setDraft(cur => ({ ...cur, enabled }))
        } catch (err) {
          setError(String(err?.message ?? err))
        }
      }

      const handleSave = async () => {
        if (!draft) return
        const parsedCmd = parseCommandLine(draft.commandLine)
        if (!parsedCmd.command.trim()) {
          setError('请填写有效的启动命令行')
          setAdvancedOpen(true)
          return
        }
        setSaving(true)
        setError('')
        setNote('')
        try {
          const cat = catalogs[draft.id]
          const payload = {
            id: draft.id,
            name: draft.name,
            enabled: draft.enabled,
            autoLaunch: draft.autoLaunch,
            allowResume: draft.allowResume !== false,
            command: parsedCmd.command,
            args: parsedCmd.args,
            mode: draft.mode || '',
            modeSource: draft.modeSource || cat?.permissionModes?.source || '',
            modeConfigId: draft.modeConfigId || cat?.permissionModes?.configId || '',
            permission: draft.permission,
            cwd: draft.cwd || '',
            model: draft.model || '',
            reasoning: draft.reasoning || '',
            reasoningConfigId: draft.reasoningConfigId || cat?.reasoningConfigId || '',
            whenToUse: draft.whenToUse || '',
            instructions: draft.instructions || '',
            forwardMcpIds: draft.forwardMcpIds || [],
            env: textToEnv(draft.envText),
          }
          const res = await request(API_SAVE_AGENT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agent: payload }),
          })
          if (res.promptBudget) setPromptBudget(res.promptBudget)
          if (res.agent) {
            setDraft(cur => (cur && cur.id === res.agent.id
              ? {
                ...res.agent,
                allowResume: res.agent.allowResume !== false,
                commandLine: res.agent.commandLine || formatCommandLine(res.agent.command, res.agent.args),
                envText: envToText(res.agent.env),
              }
              : cur))
          }
          setDirty(false)
          setNote('配置已保存并即时生效。')
          await loadAll(draft.id)
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setSaving(false)
        }
      }

      const handleQuickAddPreset = async (preset) => {
        setSaving(true)
        setError('')
        try {
          await request(API_SAVE_AGENT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              agent: {
                id: preset.id,
                name: preset.name,
                command: preset.command,
                args: preset.args || [],
                permission: preset.permission || 'allow',
                whenToUse: preset.whenToUse || '',
                enabled: true,
                autoLaunch: true,
                allowResume: true,
              },
            }),
          })
          ensureToolViewRegistered(preset.id)
          setAddingMode(false)
          await loadAll(preset.id)
          void loadCatalog(preset.id, true)
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setSaving(false)
        }
      }

      const handleCreateCustom = async (agentPayload) => {
        setSaving(true)
        setError('')
        try {
          await request(API_SAVE_AGENT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agent: agentPayload }),
          })
          ensureToolViewRegistered(agentPayload.id)
          setAddingMode(false)
          await loadAll(agentPayload.id)
          void loadCatalog(agentPayload.id, true)
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setSaving(false)
        }
      }

      const handleRemove = async () => {
        if (!selectedAgent) return
        setSaving(true)
        setError('')
        try {
          await request(API_REMOVE_AGENT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: selectedAgent.id }),
          })
          setConfirmDelete(false)
          await loadAll('')
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setSaving(false)
        }
      }

      const filteredAgents = React.useMemo(() => {
        const list = agents || []
        const q = search.trim().toLowerCase()
        if (!q) return list
        return list.filter(a =>
          a.id.toLowerCase().includes(q) ||
          (a.name || '').toLowerCase().includes(q) ||
          (a.model || '').toLowerCase().includes(q) ||
          (a.command || '').toLowerCase().includes(q))
      }, [agents, search])

      const enabledCount = (agents || []).filter(a => a.enabled).length
      const cat = selectedAgent ? catalogs[selectedAgent.id] : null
      const insp = selectedAgent ? inspections[selectedAgent.id] : null
      const nativeActiveCounts = insp && !insp.loading && !insp.error
        ? ((insp.mcpServers || []).filter(s => s.enabled !== false).length
          + (insp.skills || []).filter(s => s.enabled !== false).length)
        : null
      const sessionMcps = React.useMemo(() => {
        if (insp && !insp.loading && Array.isArray(insp.sessionMcpCandidates)) return insp.sessionMcpCandidates
        if (selectedAgent && Array.isArray(selectedAgent.sessionMcpCandidates)) return selectedAgent.sessionMcpCandidates
        return hostMcps || []
      }, [insp, selectedAgent, hostMcps])
      const activeForwardMcpCount = React.useMemo(() => {
        if (!draft) return 0
        const chosenIds = new Set(draft.forwardMcpIds || [])
        const family = selectedAgent?.family || ''
        return sessionMcps.filter(cand =>
          chosenIds.has(cand.id)
          && cand.nativeState !== 'enabled'
          && cand.ready !== false
          && isTransportSupportedForAgent(cand, cat, family),
        ).length
      }, [draft, sessionMcps, cat, selectedAgent?.family])
      const envEntriesCount = React.useMemo(() => Object.keys(textToEnv(draft?.envText)).length, [draft?.envText])
      const linkedReasoning = resolveReasoningForModel(cat, draft?.model)

      ensureStylesInjected()
      return h('section', { className: 'acpHubPage' },

        /* Left Master Rail */
        h('aside', { className: 'acpHubRail' },
          h('div', { className: 'acpHubRailHead' },
            h('div', { className: 'acpHubRailTitleWrap' },
              h('h1', { className: 'acpHubRailTitle' }, 'ACP Hub'),
              h('div', { className: 'acpHubRailSub' },
                agents === null
                  ? '正在加载…'
                  : `已启用 ${enabledCount} / 共 ${(agents || []).length} 个`,
                promptBudget
                  ? h('span', { className: 'acpHubPill', title: '主会话常驻提示词预估开销' }, `~${promptBudget.estimatedTokens} tok`)
                  : null,
                activeRuns.length > 0
                  ? h('span', { className: 'acpHubPill acpHubPillBrand' }, `运行中 ${activeRuns.length}`)
                  : null)),
            h('button', {
              type: 'button',
              className: 'acpHubBtn acpHubBtnPrimary acpHubBtnSm',
              onClick: () => { setAddingMode(true); setError(''); setNote('') },
            }, '+ 添加')),

          h('div', { className: 'acpHubSearchWrap' },
            h('input', {
              className: 'acpHubSearch',
              placeholder: '筛选智能体 / 模型 / 命令…',
              value: search,
              onChange: e => setSearch(e.target.value),
            })),

          h('div', { className: 'acpHubList' },
            filteredAgents.map(agent => h('div', {
              key: agent.id,
              className: 'acpHubRow'
                + (!addingMode && agent.id === selectedId ? ' acpHubRowActive' : '')
                + (!agent.enabled ? ' acpHubRowOff' : ''),
              onClick: () => {
                setAddingMode(false)
                setSelectedId(agent.id)
              },
            },
            h('span', { className: 'acpHubAvatar' },
              h('img', { src: `/api/acp-hub.icon?id=${encodeURIComponent(agent.id)}`, alt: '' })),
            h('div', { className: 'acpHubRowBody' },
              h('div', { className: 'acpHubRowTop' },
                h('span', { className: 'acpHubRowName' }, agent.name || agent.id),
                h('span', { className: 'acpHubRowId' }, `@${agent.id}`)),
              h('div', { className: 'acpHubRowMeta' },
                h('span', {
                  className: 'acpHubDot' + (agent.ready ? '' : ' acpHubDotWarn'),
                  title: agent.ready ? `CLI 就绪: ${agent.resolvedCommand}` : `未找到命令: ${agent.command}`,
                }),
                h('span', null, shortModelName(agent.model, catalogs[agent.id])),
                agent.activeCount > 0 ? h('span', { style: { color: 'var(--dsw-alias-state-business-primary, #4176e6)' } }, `· ${agent.activeCount} 运行中`) : null)),
            h(Switch, {
              checked: agent.enabled,
              title: agent.enabled ? '点击停用此 ACP 智能体' : '点击启用此 ACP 智能体',
              onChange: next => void handleQuickToggle(agent.id, next),
            }))),

            agents !== null && filteredAgents.length === 0
              ? h('div', { style: { padding: '16px 10px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } },
                search ? '没有匹配的智能体' : '尚未添加任何 ACP 智能体')
              : null)),

        /* Right Detail Inspector */
        h('div', { className: 'acpHubMain' },
          addingMode || (agents !== null && agents.length === 0)
            ? h(AddAgentView, {
              presets,
              busy: saving,
              onQuickAdd: handleQuickAddPreset,
              onCreateCustom: handleCreateCustom,
              onCancel: agents && agents.length > 0 ? () => setAddingMode(false) : null,
            })
            : !selectedAgent || !draft
              ? h('div', { className: 'acpHubBody' },
                h('p', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '请在左侧选择一个 ACP 智能体，或点击「+ 添加」。'))
              : h(React.Fragment, null,
                /* Sticky Hero Header */
                h('header', { className: 'acpHubHero' },
                  h('div', { className: 'acpHubHeroLeft' },
                    h('span', { className: 'acpHubAvatar acpHubAvatarLg' },
                      h('img', { src: `/api/acp-hub.icon?id=${encodeURIComponent(selectedAgent.id)}`, alt: '' })),
                    h('div', null,
                      h('div', { className: 'acpHubHeroTitleRow' },
                        h('h2', { className: 'acpHubHeroTitle' }, draft.name || selectedAgent.id),
                        h('span', { className: 'acpHubPill acpHubPillMono' }, `/${selectedAgent.id} <任务>`),
                        h('span', { className: 'acpHubPill acpHubPillMono' }, `@${selectedAgent.id}`)),
                      h('div', { className: 'acpHubHeroPills' },
                        h('span', { className: 'acpHubPill ' + (selectedAgent.ready ? 'acpHubPillOk' : 'acpHubPillErr') },
                          selectedAgent.ready ? 'CLI 就绪' : '命令未找到'),
                        draft.allowResume === false
                          ? h('span', { className: 'acpHubPill' }, '强制每次独立子会话')
                          : (cat?.capabilities?.sessionResume || cat?.capabilities?.loadSession
                            ? h('span', { className: 'acpHubPill acpHubPillBrand' }, '支持按需续接（主 Agent 自主判定）')
                            : null),
                        cat?.permissionModes?.options?.length
                          ? h('span', { className: 'acpHubPill' }, `${cat.permissionModes.options.length} 种原生权限模式`)
                          : null))),

                  h('div', { className: 'acpHubHeroActions' },
                    note ? h('span', { className: 'acpHubNoteOk' }, note) : null,
                    h('button', {
                      type: 'button',
                      className: 'acpHubBtn',
                      disabled: cat?.loading,
                      onClick: () => void loadCatalog(selectedAgent.id, true, draft.model || ''),
                    }, cat?.loading ? '探测中…' : '刷新模型与权限'),
                    confirmDelete
                      ? h(React.Fragment, null,
                        h('button', {
                          type: 'button',
                          className: 'acpHubBtn acpHubBtnDanger',
                          disabled: saving,
                          onClick: handleRemove,
                        }, '确认删除'),
                        h('button', {
                          type: 'button',
                          className: 'acpHubBtn',
                          onClick: () => setConfirmDelete(false),
                        }, '取消'))
                      : h('button', {
                        type: 'button',
                        className: 'acpHubBtn',
                        onClick: () => setConfirmDelete(true),
                      }, '删除'),
                    h('button', {
                      type: 'button',
                      className: 'acpHubBtn acpHubBtnPrimary',
                      disabled: saving,
                      onClick: handleSave,
                    }, saving ? '保存中…' : (dirty ? '保存更改 *' : '保存更改')))),

                /* Tabs */
                h('nav', { className: 'acpHubTabs' },
                  h('button', {
                    type: 'button',
                    className: 'acpHubTab' + (activeTab === 'model' ? ' acpHubTabActive' : ''),
                    onClick: () => setActiveTab('model'),
                  }, '模型与权限'),
                  h('button', {
                    type: 'button',
                    className: 'acpHubTab' + (activeTab === 'delegation' ? ' acpHubTabActive' : ''),
                    onClick: () => setActiveTab('delegation'),
                  }, '适用场景与会话 MCP',
                  activeForwardMcpCount > 0
                    ? h('span', { className: 'acpHubTabBadge' }, activeForwardMcpCount)
                    : null),
                  h('button', {
                    type: 'button',
                    className: 'acpHubTab' + (activeTab === 'native' ? ' acpHubTabActive' : ''),
                    onClick: () => setActiveTab('native'),
                  }, '原生 MCP & Skills 透视',
                  nativeActiveCounts !== null ? h('span', { className: 'acpHubTabBadge' }, nativeActiveCounts) : null)),

                /* Tab Content */
                h('div', { className: 'acpHubBody' },
                  h('div', { className: activeTab === 'native' ? 'acpHubContainerWide' : 'acpHubContainer' },
                    error ? h('div', { className: 'acpHubAlertErr' }, error) : null,
                    cat?.error ? h('div', { className: 'acpHubAlertErr' }, `ACP 握手探测提示：${cat.error}`) : null,

                    activeTab === 'model'
                      ? h(React.Fragment, null,
                        h('div', { className: 'acpHubSection' },
                          h('div', { className: 'acpHubSectionHead' },
                            h('div', null,
                              h('h3', { className: 'acpHubSectionTitle' }, '模型与推理档位（实时联动）'),
                              h('p', { className: 'acpHubSectionDesc' }, '切换模型时自动同步该模型支持的原始推理档位（原样展示，不做二次翻译），启动会话后按顺序下发。'))),
                          h('div', { className: 'acpHubGrid' },
                            h('div', { className: 'acpHubField' },
                              h('div', { className: 'acpHubLabelRow' },
                                h('label', { className: 'acpHubLabel' }, '固定模型（Model）'),
                                cat?.models?.length ? h('span', { className: 'acpHubHint' }, `已探测 ${cat.models.length} 个模型`) : null),
                              h(ModelSelect, {
                                catalog: cat,
                                value: draft.model,
                                onChange: v => void handleModelChange(v),
                              })),
                            h('div', { className: 'acpHubField' },
                              h('div', { className: 'acpHubLabelRow' },
                                h('label', { className: 'acpHubLabel' }, '推理强度（Reasoning Effort）'),
                                linkedReasoning.options.length > 0
                                  ? h('span', { className: 'acpHubHint' }, `${linkedReasoning.options.length} 个原始档位`)
                                  : null),
                              h(ReasoningSelect, {
                                catalog: cat,
                                modelValue: draft.model,
                                value: draft.reasoning,
                                onChange: v => patchDraft('reasoning', v),
                              })))),

                        h('div', { className: 'acpHubSection' },
                          h('div', { className: 'acpHubSectionHead' },
                            h('div', null,
                              h('h3', { className: 'acpHubSectionTitle' }, '权限模式与会话行为'),
                              h('p', { className: 'acpHubSectionDesc' }, '高频调控显示名称、客户端原生权限以及主/子会话委派开关。'))),
                          h('div', { className: 'acpHubGrid', style: { marginBottom: '14px' } },
                            h('div', { className: 'acpHubField' },
                              h('label', { className: 'acpHubLabel' }, '显示名称'),
                              h('input', {
                                className: 'acpHubInput',
                                value: draft.name || '',
                                onChange: e => patchDraft('name', e.target.value),
                              })),
                            h('div', { className: 'acpHubField' },
                              h('div', { className: 'acpHubLabelRow' },
                                h('label', { className: 'acpHubLabel' }, '客户端权限模式（实时获取自 Agent）'),
                                cat?.permissionModes?.options?.length
                                  ? h('span', { className: 'acpHubHint' }, `已同步 ${cat.permissionModes.options.length} 项`)
                                  : null),
                              h(PermissionModeSelect, {
                                catalog: cat,
                                modeValue: draft.mode,
                                fallbackPermission: draft.permission,
                                onModeChange: handleModeChange,
                                onFallbackChange: v => patchDraft('permission', v),
                              }))),
                          h('div', null,
                            h('div', { className: 'acpHubToggleRow' },
                              h('div', null,
                                h('div', { className: 'acpHubLabel' }, '启用该 ACP 智能体'),
                                h('div', { className: 'acpHubHint' }, `开启后允许通过 delegate_acp、@${selectedAgent.id} 或斜杠命令 /${selectedAgent.id} 委派。`)),
                              h(Switch, {
                                checked: draft.enabled,
                                onChange: v => patchDraft('enabled', v),
                              })),
                            h('div', { className: 'acpHubToggleRow' },
                              h('div', null,
                                h('div', { className: 'acpHubLabel' }, '允许在同一个 Subagent 会话里继续（按需续接）'),
                                h('div', { className: 'acpHubHint' }, '开启时：允许续接，但不会盲目默认续接——由主智能体按任务性质自主判定是继续原会话（连续追问/返工）还是新开独立会话（新议题/零偏见审查），也支持在子会话内手动追问；关闭时：底层绝对禁止续接，每次委派强制新建干净子会话。')),
                              h(Switch, {
                                checked: draft.allowResume !== false,
                                onChange: v => patchDraft('allowResume', v),
                              })),
                            h('div', { className: 'acpHubToggleRow' },
                              h('div', null,
                                h('div', { className: 'acpHubLabel' }, '纳入主会话自动路由索引（Auto-launch）'),
                                h('div', { className: 'acpHubHint' }, '关闭后不向主会话提示词写入该智能体摘要（0 Token 占用），仅在你输入 /命令或显式指定时调用。')),
                              h(Switch, {
                                checked: draft.autoLaunch,
                                onChange: v => patchDraft('autoLaunch', v),
                              })))),

                        h('div', { className: 'acpHubSection' },
                          h('div', { className: 'acpHubDrawerBar' },
                            h('div', { className: 'acpHubDrawerSummary' },
                              h('h3', { className: 'acpHubSectionTitle', style: { marginRight: '4px' } }, '进程与环境高级配置（低频）'),
                              !advancedOpen
                                ? h(React.Fragment, null,
                                  h('span', { className: 'acpHubDrawerCmd', title: draft.commandLine || '' },
                                    draft.commandLine || '未设置启动命令'),
                                  h('span', { className: 'acpHubPill ' + (selectedAgent.ready ? 'acpHubPillOk' : 'acpHubPillErr') },
                                    selectedAgent.ready ? '已就绪' : '未就绪'),
                                  draft.cwd ? h('span', { className: 'acpHubPill', title: draft.cwd }, '固定目录') : null,
                                  envEntriesCount > 0 ? h('span', { className: 'acpHubPill' }, `环境变量 ${envEntriesCount} 项`) : null)
                                : h('span', { className: 'acpHubHint' },
                                  selectedAgent.resolvedCommand
                                    ? `当前实际解析路径：${selectedAgent.resolvedCommand}`
                                    : '支持命令名或绝对路径（独立 ACP 桥接程序无需参数，多合一 CLI 如 mcode acp / codebuddy --acp 写在同一行即可）')),
                            h('button', {
                              type: 'button',
                              className: 'acpHubBtn acpHubBtnSm',
                              'aria-expanded': advancedOpen,
                              onClick: () => setAdvancedOpen(v => !v),
                            }, advancedOpen ? '收起 ▴' : '展开修改 ▾')),
                          advancedOpen
                            ? h('div', { className: 'acpHubGrid', style: { marginTop: '14px' } },
                              h('div', { className: 'acpHubField acpHubFieldFull' },
                                h('label', { className: 'acpHubLabel' }, '启动命令行（Command Line）'),
                                h('input', {
                                  className: 'acpHubInput acpHubMono',
                                  value: draft.commandLine || '',
                                  placeholder: '例如 zcode-acp 或 /path/to/mcode acp',
                                  onChange: e => patchDraft('commandLine', e.target.value),
                                }),
                                h('div', { className: 'acpHubHint' },
                                  '合并命令与启动参数（POSIX 引号/空格分词）：独立 ACP 协议桥接程序（如 zcode-acp）无需附加参数；多合一终端 CLI 请在后面附带协议子命令（如 mcode acp、codebuddy --acp）。')),
                              h('div', { className: 'acpHubField acpHubFieldFull' },
                                h('label', { className: 'acpHubLabel' }, '固定工作目录覆盖（可选）'),
                                h('input', {
                                  className: 'acpHubInput acpHubMono',
                                  value: draft.cwd || '',
                                  placeholder: '留空则默认继承主会话当前工作目录',
                                  onChange: e => patchDraft('cwd', e.target.value),
                                })),
                              h('div', { className: 'acpHubField acpHubFieldFull' },
                                h('label', { className: 'acpHubLabel' }, '附加环境变量（每行 KEY=VALUE）'),
                                h('textarea', {
                                  className: 'acpHubTextarea acpHubMono',
                                  value: draft.envText || '',
                                  placeholder: '例如 ZCODE_ACP_SKIP_ENTITLEMENT=1',
                                  onChange: e => patchDraft('envText', e.target.value),
                                })))
                            : null))
                      : null,

                    activeTab === 'delegation'
                      ? h(React.Fragment, null,
                        h('div', { className: 'acpHubSection' },
                          h('div', { className: 'acpHubSectionHead' },
                            h('div', null,
                              h('h3', { className: 'acpHubSectionTitle' }, '主会话提示词渐进式披露策略（全局生效）'),
                              h('p', { className: 'acpHubSectionDesc' }, '常驻工具面已收敛为仅暴露单个 delegate_acp 入口；下方控制「适用场景」如何进入主会话系统提示词。')),
                            promptBudget
                              ? h('span', { className: 'acpHubPill acpHubPillBrand' },
                                `当前常驻开销：${promptBudget.chars} 字符 / ~${promptBudget.estimatedTokens} tok`)
                              : null),
                          h('div', { className: 'acpHubRadioGroup' },
                            [
                              {
                                id: 'compact',
                                title: '渐进式摘要索引（推荐）',
                                desc: '每个智能体仅注入 ≤42 字超短索引（约 30~40 tok/个），完整说明由主模型按需调 list_acp_agents 读取。',
                              },
                              {
                                id: 'full',
                                title: '全量场景常驻',
                                desc: '将完整「适用场景」直接写入主会话系统提示词（命中 Prefix Cache 后成本很低，适合少量主力 Agent）。',
                              },
                              {
                                id: 'none',
                                title: '纯按需发现（0 Token）',
                                desc: '不写入系统提示词（0 tok），仅通过 /命令 或模型主动调用 list_acp_agents 发现。',
                              },
                            ].map(opt => h('button', {
                              key: opt.id,
                              type: 'button',
                              className: 'acpHubRadioCard' + ((promptBudget?.promptDisclosure || 'compact') === opt.id ? ' acpHubRadioCardActive' : ''),
                              onClick: () => void handleDisclosureChange(opt.id),
                            },
                            h('div', { style: { fontWeight: 650, fontSize: '12px' } }, opt.title),
                            h('div', { className: 'acpHubHint' }, opt.desc))))),

                        h('div', { className: 'acpHubSection' },
                          h('div', { className: 'acpHubSectionHead' },
                            h('div', null,
                              h('h3', { className: 'acpHubSectionTitle' }, `${draft.name || selectedAgent.id} 的适用场景与常驻委派指令`),
                              h('p', { className: 'acpHubSectionDesc' }, '「适用场景」供 DSH 主模型选人参考；「常驻委派指令」完全不占主会话 Token，仅在委派给外部智能体的首轮前置发送。'))),
                          h('div', { className: 'acpHubGrid' },
                            h('div', { className: 'acpHubField acpHubFieldFull' },
                              h('label', { className: 'acpHubLabel' }, '适用场景（When to use）'),
                              h('input', {
                                className: 'acpHubInput',
                                value: draft.whenToUse || '',
                                placeholder: '一句话描述何时应该把任务委派给该 ACP 智能体…',
                                onChange: e => patchDraft('whenToUse', e.target.value),
                              })),
                            h('div', { className: 'acpHubField acpHubFieldFull' },
                              h('label', { className: 'acpHubLabel' }, '常驻委派指令（Standing Instructions，主会话 0 Token）'),
                              h('textarea', {
                                className: 'acpHubTextarea',
                                style: { minHeight: '120px' },
                                value: draft.instructions || '',
                                placeholder: '例如：只围绕核心需求与直接影响面审查；禁止过度防御与过度设计；输出按「阻断 / 重要 / 建议」分组并附文件行号。',
                                onChange: e => patchDraft('instructions', e.target.value),
                              })))),

                        h('div', { className: 'acpHubSection' },
                          h('div', { className: 'acpHubSectionHead' },
                            h('div', null,
                              h('h3', { className: 'acpHubSectionTitle' }, 'DSH 委派会话级附加 MCP（不改外部客户端配置）'),
                              h('p', { className: 'acpHubSectionDesc' }, '汇总本机 DSH 宿主挂载与当前客户端配置中的所有 MCP：客户端自身已启用的服务自动锁定勾选并跳过重复拉起；未启用项与 DSH 独有服务支持按需临时注入。'))),
                          sessionMcps.length === 0
                            ? h('div', { className: 'acpHubHint' }, '未检测到可用的本机 DSH 或客户端 MCP 候选。')
                            : h('div', { className: 'acpHubItemGrid' },
                              ...sessionMcps.map((cand) => {
                                const nativeEnabled = cand.nativeState === 'enabled'
                                const nativeDisabled = cand.nativeState === 'disabled'
                                const transportOk = isTransportSupportedForAgent(cand, cat, selectedAgent.family || '')
                                const blockedReason = cand.ready === false
                                  ? '可执行命令未找到'
                                  : (!transportOk ? `客户端未声明支持 ${cand.wireType || cand.transport}` : '')
                                const checkboxDisabled = nativeEnabled || Boolean(blockedReason)
                                const checked = nativeEnabled || ((draft.forwardMcpIds || []).includes(cand.id) && !blockedReason)
                                const cardClass = 'acpHubCheckCard'
                                  + (nativeEnabled ? ' acpHubCheckCardLocked' : (blockedReason ? ' acpHubCheckCardDisabled' : ''))
                                return h('label', { key: cand.id, className: cardClass },
                                  h('input', {
                                    type: 'checkbox',
                                    checked,
                                    disabled: checkboxDisabled,
                                    onChange: () => {
                                      if (!checkboxDisabled) toggleForwardMcp(cand.id)
                                    },
                                  }),
                                  h('div', { style: { minWidth: 0, flex: 1 } },
                                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
                                      h('span', { style: { fontWeight: 600, fontSize: '12.5px' } }, cand.name),
                                      h('span', { className: 'acpHubPill' }, cand.transport),
                                      nativeEnabled
                                        ? h('span', { className: 'acpHubPill acpHubPillOk' }, '客户端原生已启用')
                                        : (nativeDisabled
                                          ? h('span', { className: 'acpHubPill' }, '客户端未启用 · 可临时注入')
                                          : h('span', { className: 'acpHubPill acpHubPillBrand' }, '来自 DSH 宿主 · 可注入')),
                                      cand.inDshHost && cand.nativeState !== 'absent'
                                        ? h('span', { className: 'acpHubPill' }, 'DSH 宿主')
                                        : null,
                                      blockedReason
                                        ? h('span', { className: 'acpHubPill acpHubPillErr' }, blockedReason)
                                        : null),
                                    cand.summary
                                      ? h('div', { className: 'acpHubHint acpHubMono', style: { marginTop: '3px', wordBreak: 'break-all' } }, cand.summary)
                                      : null,
                                    nativeEnabled
                                      ? h('div', { className: 'acpHubHint', style: { marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
                                        h('span', null, '已在外部客户端真源启用，委派时自动复用原生实例，不重复注入。'),
                                        h('button', {
                                          type: 'button',
                                          className: 'acpInspSwitchLink',
                                          onClick: (e) => {
                                            e.preventDefault()
                                            setActiveTab('native')
                                          },
                                        }, '查看透视'))
                                      : (cand.sourceLabel
                                        ? h('div', { className: 'acpHubHint', style: { marginTop: '2px' } }, `来源：${cand.sourceLabel}`)
                                        : null)))
                              }))))
                      : null,

                    activeTab === 'native'
                      ? h(NativeInspectorTab, {
                        agent: selectedAgent,
                        inspection: insp,
                        onRefresh: () => void loadInspection(selectedAgent.id),
                      })
                      : null)))))
    }

    function createResetBus() {
      const listeners = new Set()
      return {
        subscribe(fn) {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
        emit() {
          for (const fn of Array.from(listeners)) {
            try { fn() } catch {}
          }
        },
      }
    }

    function selectAcpSubagentComposer(owner) {
      const sid = owner?.sessionId
      if (typeof sid !== 'string' || !sid.startsWith('session-acp-')) return null
      return {
        sessionId: sid,
        running: Boolean(owner?.session?.running),
      }
    }

    function selectNativeReadOnlySubagent(owner) {
      const sid = owner?.sessionId
      if (typeof sid === 'string' && sid.startsWith('session-acp-')) return null
      const subagent = owner?.session?.subagent
      if (!subagent) return null
      const running = Boolean(owner?.session?.running)
      if (subagent.address?.mode === 'unknown') return { reason: 'unknown', running }
      if (subagent.address?.mode === 'one-shot') return { reason: 'one-shot', running }
      return null
    }

    function apply(ctx) {
      runtimeCtx = ctx
      ensureStylesInjected()
      const bus = createResetBus()

      if (ctx.locale?.register) {
        ctx.effect(() => ctx.locale.register(NS, {
          zh: { panel: 'ACP Hub' },
          en: { panel: 'ACP Hub' },
        }), 'acp-hub: locale')
      }

      if (ctx.on) {
        ctx.effect(() => ctx.on('connection/reset', () => bus.emit()), 'acp-hub: reset')
      }

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        inject: () => ({ bus }),
      }, Page))

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 21,
        label: () => 'ACP Hub',
      }, SidebarIcon))

      // Intercept composer inside `session-acp-*` views (priority -20 beats native -15 and ui-subagent's -10)
      ctx.slots.inject('conversation.composer', () => ctx.slots.register({
        name: 'conversation.composer',
        priority: -20,
        select: selectAcpSubagentComposer,
      }, AcpSubagentComposer))

      // Enhance native DSH read-only subagents with bottom stats dock (priority -15 beats ui-subagent's -10)
      ctx.slots.inject('conversation.composer', () => ctx.slots.register({
        name: 'conversation.composer',
        priority: -15,
        select: selectNativeReadOnlySubagent,
      }, NativeSubagentReadOnlyWithDock))

      slotRegistrar = (toolKey) => {
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: toolKey,
        }, AcpAgentCall))
      }

      for (const key of PRESET_KEYS) {
        ensureToolViewRegistered(key)
      }

      void request(API_STATE).then((body) => {
        for (const agent of body?.agents || []) {
          ensureToolViewRegistered(agent.id)
        }
      }).catch(() => {})
    }

    return {
      inject: ['slots', 'locale'],
      apply,
      __testing: {
        STYLES,
        parseCommandLine,
        formatCommandLine,
        parseModelOption,
        formatModelDisplay,
        shortModelName,
        formatTokensCompact,
        formatExactTokens,
        formatCacheHitPercent,
        deriveWindowStats,
        computeContextOccupancy,
        HubSelect,
        ModelSelect,
        AcpSubagentComposer,
        NativeSubagentReadOnlyWithDock,
        SubagentStatsDock,
        NativeInspectorTab,
        selectAcpSubagentComposer,
        selectNativeReadOnlySubagent,
        ensureStylesInjected,
        sessionInfoCache,
        seedSessionInfoCache,
      },
    }
  },
})
