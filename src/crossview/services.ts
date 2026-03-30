import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
	CROSSVIEW_NAMESPACE,
	CROSSVIEW_RELEASE,
	CROSSVIEW_SERVICE,
} from './constants';
import type { InstallStatus } from './types';

async function isForwardReachable(port: number): Promise<boolean> {
	try {
		await fetch(`http://localhost:${port}`, { method: 'GET', mode: 'no-cors' });
		return true;
	} catch {
		return false;
	}
}

export function getHelmUpgradeCommand(chartRef: string, chartVersion?: string): string {
	const versionFlag = chartVersion?.trim() ? ` --version ${chartVersion.trim()}` : '';
	return [
		`helm upgrade --install ${CROSSVIEW_RELEASE} ${chartRef}${versionFlag}`,
		`--namespace ${CROSSVIEW_NAMESPACE}`,
		'--create-namespace',
		'--set config.server.port=3001',
		'--set-string config.server.auth.mode=none',
		'--set config.server.log.level=info',
		'--set-string config.server.cors.origin=http://localhost:3001',
		'--set config.server.cors.credentials=false',
		'--set database.enabled=false',
		'--set config.database.enabled=false',
		'--set-string config.vite.server.proxy.api.target=http://localhost:3001',
		'--set config.vite.server.proxy.api.changeOrigin=true',
		'--wait --timeout 10m',
	].join(' ');
}

export function getHelmRepoUpdateCommand(): string {
	return 'helm repo update';
}

export function getHelmUninstallCommand(): string {
	return `helm uninstall ${CROSSVIEW_RELEASE} --namespace ${CROSSVIEW_NAMESPACE} --wait --timeout 5m`;
}

export function createInstallerResources() {
	return [
		{
			apiVersion: 'v1',
			kind: 'Namespace',
			metadata: {
				name: CROSSVIEW_NAMESPACE,
			},
		},
		{
			apiVersion: 'v1',
			kind: 'ServiceAccount',
			metadata: {
				name: 'crossview-helm-installer',
				namespace: CROSSVIEW_NAMESPACE,
			},
		},
		{
			apiVersion: 'rbac.authorization.k8s.io/v1',
			kind: 'ClusterRoleBinding',
			metadata: {
				name: 'crossview-helm-installer-admin',
			},
			roleRef: {
				apiGroup: 'rbac.authorization.k8s.io',
				kind: 'ClusterRole',
				name: 'cluster-admin',
			},
			subjects: [
				{
					kind: 'ServiceAccount',
					name: 'crossview-helm-installer',
					namespace: CROSSVIEW_NAMESPACE,
				},
			],
		},
	];
}

export function createHelmJob(jobName: string, helmCommand: string) {
	return {
		apiVersion: 'batch/v1',
		kind: 'Job',
		metadata: {
			name: jobName,
			namespace: CROSSVIEW_NAMESPACE,
		},
		spec: {
			ttlSecondsAfterFinished: 90,
			backoffLimit: 0,
			template: {
				metadata: {
					labels: {
						app: 'crossview-helm-installer',
					},
				},
				spec: {
					restartPolicy: 'Never',
					serviceAccountName: 'crossview-helm-installer',
					containers: [
						{
							name: 'helm',
							image: 'alpine/helm:3.16.3',
							imagePullPolicy: 'IfNotPresent',
							command: ['/bin/sh', '-ec'],
							args: [helmCommand],
						},
					],
				},
			},
		},
	};
}

export async function applyResources(resources: any[], cluster: string | null) {
	for (const resource of resources) {
		await ApiProxy.apply(resource as any, cluster ?? undefined);
	}
}

export async function fetchInstallStatus(cluster: string | null): Promise<InstallStatus> {
	try {
		const deployment = await ApiProxy.clusterRequest(
			`/apis/apps/v1/namespaces/${CROSSVIEW_NAMESPACE}/deployments/${CROSSVIEW_RELEASE}`,
			{ cluster: cluster ?? undefined }
		);
		const readyReplicas = deployment?.status?.readyReplicas ?? 0;
		const replicas = deployment?.spec?.replicas ?? 1;

		if (readyReplicas > 0) {
			return {
				deploymentExists: true,
				deploymentReady: true,
				message: `Crossview is ready (${readyReplicas}/${replicas} replicas).`,
			};
		}

		return {
			deploymentExists: true,
			deploymentReady: false,
			message: `Crossview is installed but not ready yet (${readyReplicas}/${replicas} replicas).`,
		};
	} catch {
		return {
			deploymentExists: false,
			deploymentReady: false,
			message: 'Crossview deployment was not found in this cluster.',
		};
	}
}

export async function resolveCrossviewUrl(cluster: string | null): Promise<string> {
	try {
		const ingress = await ApiProxy.clusterRequest(
			`/apis/networking.k8s.io/v1/namespaces/${CROSSVIEW_NAMESPACE}/ingresses/crossview-ingress`,
			{ cluster: cluster ?? undefined }
		);
		const host = ingress?.spec?.rules?.[0]?.host;
		if (host) {
			return `https://${host}`;
		}
	} catch {}

	try {
		const service = await ApiProxy.clusterRequest(
			`/api/v1/namespaces/${CROSSVIEW_NAMESPACE}/services/${CROSSVIEW_SERVICE}`,
			{ cluster: cluster ?? undefined }
		);
		const lb = service?.status?.loadBalancer?.ingress?.[0];
		const address = lb?.hostname || lb?.ip;
		if (address) {
			return `http://${address}`;
		}
	} catch {}

	const clusterName = cluster || '';

	try {
		const existing = await ApiProxy.listPortForward(clusterName);
		const existingCrossviewForward = existing.find(
			(item: any) =>
				item?.service === CROSSVIEW_SERVICE &&
				item?.serviceNamespace === CROSSVIEW_NAMESPACE &&
				item?.port
		);
		if (existingCrossviewForward?.port) {
			const port = Number(existingCrossviewForward.port);
			if (await isForwardReachable(port)) {
				return `http://localhost:${port}`;
			}
		}
	} catch {}

	let podName = '';
	try {
		const pods = await ApiProxy.clusterRequest(
			`/api/v1/namespaces/${CROSSVIEW_NAMESPACE}/pods`,
			{ cluster: cluster ?? undefined },
			{ labelSelector: 'app.kubernetes.io/name=crossview' }
		);
		const items = pods?.items || [];
		const running = items.find((pod: any) => pod?.status?.phase === 'Running');
		podName = running?.metadata?.name || items?.[0]?.metadata?.name || '';
	} catch {}

	if (!podName) {
		const pods = await ApiProxy.clusterRequest(
			`/api/v1/namespaces/${CROSSVIEW_NAMESPACE}/pods`,
			{ cluster: cluster ?? undefined }
		);
		const items = pods?.items || [];
		const running = items.find((pod: any) => pod?.status?.phase === 'Running');
		podName = running?.metadata?.name || items?.[0]?.metadata?.name || '';
	}

	if (!podName) {
		throw new Error('No Crossview pod found for port-forward fallback');
	}

	const forward = await ApiProxy.startPortForward(
		clusterName,
		CROSSVIEW_NAMESPACE,
		podName,
		3001,
		CROSSVIEW_SERVICE,
		CROSSVIEW_NAMESPACE,
		undefined,
		'127.0.0.1',
		`crossview-headlamp-${Date.now()}`
	);

	if (!forward?.port) {
		throw new Error('Port-forward started but no local port was returned');
	}

	return `http://localhost:${forward.port}`;
}
