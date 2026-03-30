import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
	Alert,
	Box,
	Button,
	CircularProgress,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	Paper,
	Stack,
	TextField,
	Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CHART_REF } from './constants';
import {
	applyResources,
	createHelmJob,
	createInstallerResources,
	fetchInstallStatus,
	getHelmRepoUpdateCommand,
	getHelmUninstallCommand,
	getHelmUpgradeCommand,
	resolveCrossviewUrl,
} from './services';
import type { InstallStatus } from './types';

export function CrossviewPage() {
	const cluster = K8s.useCluster();
	const [isLoading, setIsLoading] = useState(true);
	const [isInstalling, setIsInstalling] = useState(false);
	const [isChecking, setIsChecking] = useState(false);
	const [isUpdating, setIsUpdating] = useState(false);
	const [isUpdatingRepo, setIsUpdatingRepo] = useState(false);
	const [isUninstalling, setIsUninstalling] = useState(false);
	const [chartRef, setChartRef] = useState(DEFAULT_CHART_REF);
	const [chartVersion, setChartVersion] = useState('');
	const [updateVersion, setUpdateVersion] = useState('');
	const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
	const [errorText, setErrorText] = useState('');
	const [actionText, setActionText] = useState('');
	const [status, setStatus] = useState<InstallStatus | null>(null);
	const [embeddedUrl, setEmbeddedUrl] = useState('');
	const [iframeKey, setIframeKey] = useState(0);

	const loadCrossview = useCallback(async () => {
		setIsLoading(true);
		setErrorText('');

		try {
			const installStatus = await fetchInstallStatus(cluster);
			setStatus(installStatus);

			if (!installStatus.deploymentExists) {
				setEmbeddedUrl('');
				setIframeKey(prev => prev + 1);
				setIsLoading(false);
				return;
			}

			const url = await resolveCrossviewUrl(cluster);
			const separator = url.includes('?') ? '&' : '?';
			setEmbeddedUrl(`${url}${separator}_cvts=${Date.now()}`);
			setIframeKey(prev => prev + 1);
		} catch (err) {
			setEmbeddedUrl('');
			setIframeKey(prev => prev + 1);
			setErrorText(`Unable to open Crossview: ${String(err)}`);
		} finally {
			setIsLoading(false);
		}
	}, [cluster]);

	const handleInstall = useCallback(async () => {
		const trimmedChartRef = chartRef.trim();
		const selectedVersion = chartVersion.trim();
		const normalizedVersion = trimmedChartRef.startsWith('oci://')
			? selectedVersion.replace(/^v/, '')
			: selectedVersion;

		setIsInstalling(true);
		setErrorText('');
		setActionText('');
		setStatus(null);

		try {
			const resources = createInstallerResources();
			const job = createHelmJob(
				`crossview-helm-install-${Date.now()}`,
				getHelmUpgradeCommand(trimmedChartRef, normalizedVersion)
			);
			await applyResources([...resources, job], cluster);
			setChartVersion(normalizedVersion);
			setActionText('Crossview install submitted. Retrying connection in a few seconds...');
			window.setTimeout(() => {
				loadCrossview();
			}, 5000);
		} catch (err) {
			setErrorText(`Install failed: ${String(err)}`);
		} finally {
			setIsInstalling(false);
		}
	}, [chartRef, chartVersion, cluster, loadCrossview]);

	const handleCheckStatus = useCallback(async () => {
		setIsChecking(true);
		setErrorText('');

		try {
			const installStatus = await fetchInstallStatus(cluster);
			setStatus(installStatus);
		} catch (err) {
			setErrorText(`Status check failed: ${String(err)}`);
		} finally {
			setIsChecking(false);
		}
	}, [cluster]);

	const handleUpdate = useCallback(async () => {
		const trimmedChartRef = chartRef.trim();
		const selectedVersion = updateVersion.trim();
		const normalizedVersion = trimmedChartRef.startsWith('oci://')
			? selectedVersion.replace(/^v/, '')
			: selectedVersion;
		setIsUpdating(true);
		setErrorText('');
		setActionText('');

		try {
			const resources = createInstallerResources();
			const shouldUpdateRepo = !trimmedChartRef.startsWith('oci://');
			const command = shouldUpdateRepo
				? `${getHelmRepoUpdateCommand()} && ${getHelmUpgradeCommand(trimmedChartRef, normalizedVersion)}`
				: getHelmUpgradeCommand(trimmedChartRef, normalizedVersion);
			const job = createHelmJob(
				`crossview-helm-update-${Date.now()}`,
				command
			);
			await applyResources([...resources, job], cluster);
			setChartVersion(normalizedVersion);
			setIsUpdateDialogOpen(false);
			setActionText('Crossview update submitted. Reloading page in a few seconds...');
			window.setTimeout(() => {
				loadCrossview();
			}, 3000);
		} catch (err) {
			setErrorText(`Update failed: ${String(err)}`);
		} finally {
			setIsUpdating(false);
		}
	}, [chartRef, cluster, loadCrossview, updateVersion]);

	const handleOpenUpdateDialog = useCallback(() => {
		setUpdateVersion(chartVersion);
		setIsUpdateDialogOpen(true);
	}, [chartVersion]);

	const handleCloseUpdateDialog = useCallback(() => {
		if (isUpdating) {
			return;
		}
		setIsUpdateDialogOpen(false);
	}, [isUpdating]);

	const handleUpdateRepo = useCallback(async () => {
		if (chartRef.trim().startsWith('oci://')) {
			setErrorText('');
			setActionText('Helm repo update is not needed for OCI chart references.');
			return;
		}

		setIsUpdatingRepo(true);
		setErrorText('');
		setActionText('');

		try {
			const resources = createInstallerResources();
			const job = createHelmJob(
				`crossview-helm-repo-update-${Date.now()}`,
				getHelmRepoUpdateCommand()
			);
			await applyResources([...resources, job], cluster);
			setActionText('Helm repo update submitted. You can now install or update Crossview.');
		} catch (err) {
			setErrorText(`Helm repo update failed: ${String(err)}`);
		} finally {
			setIsUpdatingRepo(false);
		}
	}, [chartRef, cluster]);

	const handleUninstall = useCallback(async () => {
		const confirmed = window.confirm('Uninstall Crossview from this cluster?');
		if (!confirmed) {
			return;
		}

		setIsUninstalling(true);
		setErrorText('');
		setActionText('');

		try {
			const resources = createInstallerResources();
			const job = createHelmJob(
				`crossview-helm-uninstall-${Date.now()}`,
				getHelmUninstallCommand()
			);
			await applyResources([...resources, job], cluster);

			setEmbeddedUrl('');
			setIframeKey(prev => prev + 1);
			setStatus(null);
			setActionText('Crossview uninstall submitted. Plugin remains available in Headlamp.');
		} catch (err) {
			setErrorText(`Uninstall failed: ${String(err)}`);
		} finally {
			setIsUninstalling(false);
		}
	}, [cluster]);

	useEffect(() => {
		loadCrossview();
	}, [loadCrossview]);

	return (
		<Box sx={{ width: '100%', height: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
			<Box
				sx={{
					height: 56,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'flex-end',
					px: 2,
					borderBottom: '1px solid',
					borderColor: 'divider',
					bgcolor: 'background.paper',
				}}
			>
				<Stack direction="row" spacing={1}>
					<Button
						variant="outlined"
						size="small"
						onClick={handleUpdateRepo}
						disabled={isUpdating || isUpdatingRepo || isUninstalling || isInstalling || isChecking}
					>
						{isUpdatingRepo ? 'Updating Repo...' : 'Update Helm Repo'}
					</Button>
					<Button
						variant="contained"
						size="small"
						onClick={handleOpenUpdateDialog}
						disabled={isUpdating || isUpdatingRepo || isUninstalling || isInstalling || isChecking || !embeddedUrl}
					>
						{isUpdating ? 'Updating...' : 'Update'}
					</Button>
					<Button
						variant="outlined"
						size="small"
						color="error"
						onClick={handleUninstall}
						disabled={isUpdating || isUpdatingRepo || isUninstalling || isInstalling || isChecking}
					>
						{isUninstalling ? 'Uninstalling...' : 'Uninstall'}
					</Button>
				</Stack>
			</Box>

			<Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
				{actionText ? (
					<Box sx={{ position: 'absolute', top: 12, right: 12, zIndex: 2, maxWidth: 520 }}>
						<Alert severity="info">{actionText}</Alert>
					</Box>
				) : null}

				{isLoading ? (
					<Box
						sx={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							height: '100%',
							gap: 2,
						}}
					>
						<CircularProgress size={24} />
						<Typography variant="body2">Opening Crossview...</Typography>
					</Box>
				) : null}

				{!isLoading && !embeddedUrl ? (
					<Box
						sx={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							height: '100%',
							p: 3,
						}}
					>
						<Paper
							elevation={0}
							sx={{ p: 3, border: '1px solid', borderColor: 'divider', maxWidth: 760, width: '100%' }}
						>
							<Stack spacing={2} alignItems="center">
								<Typography variant="h6">Crossview is not available</Typography>
								<Typography variant="body2" sx={{ textAlign: 'center' }} color="text.secondary">
									Install Crossview or check its status with your preferred chart and version.
								</Typography>

								<TextField
									label="Remote Helm Chart"
									value={chartRef}
									onChange={e => setChartRef(e.target.value)}
									fullWidth
									size="small"
								/>

								<TextField
									label="Chart Version (optional)"
									value={chartVersion}
									onChange={e => setChartVersion(e.target.value)}
									placeholder="e.g. 3.8.0-rc.1"
									fullWidth
									size="small"
								/>

								{status ? (
									<Alert severity={status.deploymentReady ? 'success' : 'info'} sx={{ width: '100%' }}>
										{status.message}
									</Alert>
								) : null}

								{errorText ? (
									<Alert severity="error" sx={{ width: '100%' }}>
										{errorText}
									</Alert>
								) : null}

								<Stack direction="row" spacing={1}>
									<Button
										variant="contained"
										onClick={handleInstall}
										disabled={isInstalling || isUpdating || isUpdatingRepo || isUninstalling || isChecking || !chartRef.trim()}
									>
										{isInstalling ? 'Installing...' : 'Install'}
									</Button>
									<Button
										variant="outlined"
										onClick={handleUpdateRepo}
										disabled={isInstalling || isUpdating || isUpdatingRepo || isUninstalling || isChecking}
									>
										{isUpdatingRepo ? 'Updating Repo...' : 'Update Helm Repo'}
									</Button>
									<Button
										variant="outlined"
										onClick={handleCheckStatus}
										disabled={isInstalling || isUpdating || isUpdatingRepo || isUninstalling || isChecking}
									>
										{isChecking ? 'Checking...' : 'Check Status'}
									</Button>
									<Button
										variant="outlined"
										onClick={loadCrossview}
										disabled={isInstalling || isUpdating || isUpdatingRepo || isUninstalling || isChecking}
									>
										Open Crossview
									</Button>
								</Stack>
							</Stack>
						</Paper>
					</Box>
				) : null}

				{!isLoading && embeddedUrl ? (
					<iframe
						key={iframeKey}
						title="Crossview"
						src={embeddedUrl}
						style={{
							width: '100%',
							height: '100%',
							border: 0,
							background: 'transparent',
						}}
					/>
				) : null}
			</Box>

			<Dialog open={isUpdateDialogOpen} onClose={handleCloseUpdateDialog} fullWidth maxWidth="xs">
				<DialogTitle>Update Crossview</DialogTitle>
				<DialogContent>
					<Stack spacing={2} sx={{ mt: 1 }}>
						<Typography variant="body2" color="text.secondary">
							Set the chart version to install. Leave blank to use the latest available version.
						</Typography>
						<TextField
							autoFocus
							label="Chart Version (optional)"
							value={updateVersion}
							onChange={e => setUpdateVersion(e.target.value)}
							placeholder="e.g. 3.8.0-rc.1"
							size="small"
							fullWidth
						/>
					</Stack>
				</DialogContent>
				<DialogActions>
					<Button onClick={handleCloseUpdateDialog} disabled={isUpdating}>
						Cancel
					</Button>
					<Button variant="contained" onClick={handleUpdate} disabled={isUpdating}>
						{isUpdating ? 'Updating...' : 'Update'}
					</Button>
				</DialogActions>
			</Dialog>
		</Box>
	);
}
