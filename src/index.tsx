import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';
import { CrossviewPage } from './crossview/CrossviewPage';

registerSidebarEntry({
	parent: 'cluster',
	name: 'crossview',
	label: 'Crossview',
	url: '/crossview',
	icon: 'mdi:view-dashboard-outline',
	useClusterURL: true,
});

registerRoute({
	path: '/crossview',
	sidebar: 'crossview',
	name: 'Crossview',
	useClusterURL: true,
	isFullWidth: true,
	hideAppBar: true,
	component: CrossviewPage,
});
