# Crossview Headlamp Plugin

Crossview Headlamp Plugin adds a dedicated `Crossview` page in Headlamp so you can install, update, uninstall, and open Crossview from the cluster UI.

Crossview project repository:

- https://github.com/crossplane-contrib/crossview

## Screenshot

![Crossview Headlamp Plugin](https://raw.githubusercontent.com/MoeidHeidari/crossview-headlamp/main/public/crossview.png)

## What This Plugin Does

This plugin adds a `Crossview` sidebar page under a selected cluster and provides:

- `Install`: Runs Helm upgrade-install for Crossview.
- `Update`: Prompts for a target chart version, then runs Helm upgrade-install.
- `Update Helm Repo`: Refreshes Helm index repositories when using repo-based charts.
- `Uninstall`: Removes the Crossview Helm release from the cluster.
- `Open Crossview`: Opens Crossview in an embedded iframe once available.
- `Check Status`: Reads deployment readiness from the cluster.

## How It Works

When you click `Install`, `Update`, or `Uninstall`, the plugin creates Kubernetes resources in namespace `crossview` and launches a short-lived Kubernetes `Job` that runs Helm commands inside an `alpine/helm` container.

Core resources used by the plugin:

- Namespace: `crossview`
- ServiceAccount: `crossview-helm-installer`
- ClusterRoleBinding: `crossview-helm-installer-admin` (binds installer SA to `cluster-admin`)
- Job: one per action, for example `crossview-helm-install-<timestamp>`

## Controllers, Permissions, and Responsibilities

There are two control layers involved:

1. Plugin action handlers (in Headlamp):
They respond to UI clicks (`Install`, `Update`, `Uninstall`, `Update Helm Repo`) and submit Kubernetes resources/jobs.

2. Kubernetes controllers:
The Kubernetes Job controller executes Helm installer jobs. After the chart is installed, normal Kubernetes controllers manage Crossview deployment resources.

Important permission note:

- The installer ServiceAccount is currently bound to `cluster-admin` for maximum compatibility and simplicity.
- This is convenient for development/testing and broad cluster compatibility.
- For stricter environments, replace this with least-privilege RBAC tailored to your chart operations.

## Job Lifecycle and Cleanup

Each operation creates a new Job with `backoffLimit: 0` and auto-cleanup enabled:

- `ttlSecondsAfterFinished: 90`

This means finished jobs (successful or failed) are automatically garbage-collected by Kubernetes after roughly 90 seconds.

Why jobs are used:

- Keeps Helm execution in-cluster.
- Avoids requiring local Helm binary access from Headlamp runtime.
- Provides clear logs and events for failed operations.

## Chart Version Behavior

- For OCI charts (`oci://...`), `Update Helm Repo` is skipped because repo index updates are not required.
- For OCI chart version input, a leading `v` is normalized (for example `v3.8.0-rc.3` becomes `3.8.0-rc.3`) before Helm command execution.
- For repo-based charts, `Update` performs `helm repo update` before `helm upgrade --install`.

## How To Use

1. Open Headlamp and select your cluster.
2. Go to `Crossview` from the sidebar.
3. If Crossview is not installed:
Set `Remote Helm Chart` and optional `Chart Version`, then click `Install`.
4. To update:
Click top `Update`, enter the version in the dialog, confirm.
5. To refresh repo metadata (repo-based charts only):
Click `Update Helm Repo`.
6. To remove Crossview from cluster:
Click `Uninstall`.

## Troubleshooting

Useful commands:

```bash
kubectl -n crossview get jobs,pods,deployments
kubectl -n crossview get events --sort-by=.lastTimestamp | tail -n 100
kubectl -n crossview logs <installer-job-pod-name>
```

Common issues:

- `Error: no repositories found`:
You ran repo update without configured Helm repos. This is expected for OCI-only flows.
- `chart ... not found`:
The chart version/tag is invalid for the chosen chart reference.
- `BackoffLimitExceeded` on a job:
Check job pod logs for the underlying Helm error.

## Local Development

Build plugin:

```bash
npm run build
```

Copy plugin files to local Headlamp plugin directory (macOS):

```bash
mkdir -p "$HOME/Library/Application Support/Headlamp/plugins/crossview-headlamp"
cp -f dist/main.js package.json "$HOME/Library/Application Support/Headlamp/plugins/crossview-headlamp/"
cp -f dist/*.png "$HOME/Library/Application Support/Headlamp/plugins/crossview-headlamp/" 2>/dev/null || true
```
