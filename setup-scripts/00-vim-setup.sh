#!/bin/bash

mkdir ~/.vim
git clone https://github.com/flazz/vim-colorschemes.git ~/.vim
cd ~/.vim
git submodule add https://github.com/flazz/vim-colorschemes.git bundle/colorschemes
curl https://raw.githubusercontent.com/bpafoshizle/configs/master/.vimrc -o ~/.vimrc

