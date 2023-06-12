#!/bin/bash

kubectl --kubeconfig ~/.kube/bletchley-config \
    -n media \
    create secret docker-registry ghcr-docker-radarr \
        --docker-server=ghcr.io \
        --docker-username="${GITHUB_USERNAME}" \
        --docker-password="${GITHUB_PACKAGE_TOKEN}"  \
        --docker-email="${GITHUB_EMAIL}"