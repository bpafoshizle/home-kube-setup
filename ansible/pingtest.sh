#!/bin/bash

ansible -i ./hosts all -m ping -u ubuntu
