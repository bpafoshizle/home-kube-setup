#!/bin/bash

ansible -i ../ansible/inventory/hosts all -m ping -u ubuntu
