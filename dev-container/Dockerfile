FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && \
    apt-get install -y \
    build-essential \
    git \
    curl \
    python3.10 \
    python3.10-dev \
    python3.10-venv

# Install Node.js 20 LTS
RUN curl -sL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Install nvm    
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash 

# Set up shell to use nvm in subsequent commands
SHELL ["/bin/bash", "--login", "-c"]

# Use nvm to install and set default Node.js version
RUN source ~/.nvm/nvm.sh && \
    nvm install 20 && \
    nvm use 20 && \
    nvm alias default 20

# expose port 3000
EXPOSE 3000

CMD ["/bin/bash", "--login"]