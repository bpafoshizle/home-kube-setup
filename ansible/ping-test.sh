#!/bin/bash

ansible -i ./inventory/hosts all -m ping -u ubuntu
