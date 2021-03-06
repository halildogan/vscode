/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/debugViewlet';
import * as nls from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import * as DOM from 'vs/base/browser/dom';
import { IActionItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { ViewContainerViewlet } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IDebugService, VIEWLET_ID, State, BREAKPOINTS_VIEW_ID, IDebugConfiguration, REPL_ID } from 'vs/workbench/contrib/debug/common/debug';
import { StartAction, ConfigureAction, SelectAndStartAction, FocusSessionAction } from 'vs/workbench/contrib/debug/browser/debugActions';
import { StartDebugActionItem, FocusSessionActionItem } from 'vs/workbench/contrib/debug/browser/debugActionItems';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IProgressService, IProgressRunner } from 'vs/platform/progress/common/progress';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { memoize } from 'vs/base/common/decorators';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { DebugToolbar } from 'vs/workbench/contrib/debug/browser/debugToolbar';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ViewletPanel } from 'vs/workbench/browser/parts/views/panelViewlet';
import { IMenu, MenuId, IMenuService, MenuItemAction } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { MenuItemActionItem } from 'vs/platform/actions/browser/menuItemActionItem';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { TogglePanelAction } from 'vs/workbench/browser/panel';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';

export class DebugViewlet extends ViewContainerViewlet {

	private startDebugActionItem: StartDebugActionItem;
	private progressRunner: IProgressRunner;
	private breakpointView: ViewletPanel;
	private panelListeners = new Map<string, IDisposable>();
	private debugToolbarMenu: IMenu;

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IProgressService private readonly progressService: IProgressService,
		@IDebugService private readonly debugService: IDebugService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super(VIEWLET_ID, `${VIEWLET_ID}.state`, false, configurationService, layoutService, telemetryService, storageService, instantiationService, themeService, contextMenuService, extensionService, contextService);

		this._register(this.debugService.onDidChangeState(state => this.onDebugServiceStateChange(state)));
		this._register(this.contextService.onDidChangeWorkbenchState(() => this.updateTitleArea()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('debug.toolBarLocation')) {
				this.updateTitleArea();
			}
		}));
	}

	create(parent: HTMLElement): void {
		super.create(parent);
		DOM.addClass(parent, 'debug-viewlet');
	}

	focus(): void {
		super.focus();

		if (this.startDebugActionItem) {
			this.startDebugActionItem.focus();
		}
	}

	@memoize
	private get startAction(): StartAction {
		return this._register(this.instantiationService.createInstance(StartAction, StartAction.ID, StartAction.LABEL));
	}

	@memoize
	private get configureAction(): ConfigureAction {
		return this._register(this.instantiationService.createInstance(ConfigureAction, ConfigureAction.ID, ConfigureAction.LABEL));
	}

	@memoize
	private get toggleReplAction(): ToggleReplAction {
		return this._register(this.instantiationService.createInstance(ToggleReplAction, ToggleReplAction.ID, ToggleReplAction.LABEL));
	}

	@memoize
	private get selectAndStartAction(): SelectAndStartAction {
		return this._register(this.instantiationService.createInstance(SelectAndStartAction, SelectAndStartAction.ID, nls.localize('startAdditionalSession', "Start Additional Session")));
	}

	getActions(): IAction[] {
		if (this.showInitialDebugActions) {
			return [this.startAction, this.configureAction, this.toggleReplAction];
		}

		if (!this.debugToolbarMenu) {
			this.debugToolbarMenu = this.menuService.createMenu(MenuId.DebugToolbar, this.contextKeyService);
			this.toDispose.push(this.debugToolbarMenu);
		}
		return DebugToolbar.getActions(this.debugToolbarMenu, this.debugService, this.instantiationService);
	}

	get showInitialDebugActions(): boolean {
		const state = this.debugService.state;
		return state === State.Inactive || this.configurationService.getValue<IDebugConfiguration>('debug').toolBarLocation !== 'docked';
	}

	getSecondaryActions(): IAction[] {
		if (this.showInitialDebugActions) {
			return [];
		}

		return [this.selectAndStartAction, this.configureAction, this.toggleReplAction];
	}

	getActionItem(action: IAction): IActionItem | null {
		if (action.id === StartAction.ID) {
			this.startDebugActionItem = this.instantiationService.createInstance(StartDebugActionItem, null, action);
			return this.startDebugActionItem;
		}
		if (action.id === FocusSessionAction.ID) {
			return new FocusSessionActionItem(action, this.debugService, this.themeService, this.contextViewService);
		}
		if (action instanceof MenuItemAction) {
			return new MenuItemActionItem(action, this.keybindingService, this.notificationService, this.contextMenuService);
		}

		return null;
	}

	focusView(id: string): void {
		const view = this.getView(id);
		if (view) {
			view.focus();
		}
	}

	private onDebugServiceStateChange(state: State): void {
		if (this.progressRunner) {
			this.progressRunner.done();
		}

		if (state === State.Initializing) {
			this.progressRunner = this.progressService.show(true);
		}

		if (this.configurationService.getValue<IDebugConfiguration>('debug').toolBarLocation === 'docked') {
			this.updateTitleArea();
		}
	}

	addPanels(panels: { panel: ViewletPanel, size: number, index?: number }[]): void {
		super.addPanels(panels);

		for (const { panel } of panels) {
			// attach event listener to
			if (panel.id === BREAKPOINTS_VIEW_ID) {
				this.breakpointView = panel;
				this.updateBreakpointsMaxSize();
			} else {
				this.panelListeners.set(panel.id, panel.onDidChange(() => this.updateBreakpointsMaxSize()));
			}
		}
	}

	removePanels(panels: ViewletPanel[]): void {
		super.removePanels(panels);
		for (const panel of panels) {
			dispose(this.panelListeners.get(panel.id));
			this.panelListeners.delete(panel.id);
		}
	}

	private updateBreakpointsMaxSize(): void {
		if (this.breakpointView) {
			// We need to update the breakpoints view since all other views are collapsed #25384
			const allOtherCollapsed = this.panels.every(view => !view.isExpanded() || view === this.breakpointView);
			this.breakpointView.maximumBodySize = allOtherCollapsed ? Number.POSITIVE_INFINITY : this.breakpointView.minimumBodySize;
		}
	}
}

class ToggleReplAction extends TogglePanelAction {
	static readonly ID = 'debug.toggleRepl';
	static LABEL = nls.localize({ comment: ['Debug is a noun in this context, not a verb.'], key: 'debugConsoleAction' }, 'Debug Console');

	constructor(id: string, label: string,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IPanelService panelService: IPanelService
	) {
		super(id, label, REPL_ID, panelService, layoutService, 'debug-action toggle-repl');
	}
}
