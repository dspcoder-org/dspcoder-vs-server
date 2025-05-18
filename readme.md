# DSPCoder-server

#### Clone and build dev container
    docker build --platform linux/amd64 -t dspcoder-vs-server .

    Start Container:
    docker run -d --name container-dspcoder-vs-server -p 8080:8080 dspcoder-vs-server


#### steps to build and development (Experimental) :
    After this gets concluded, a script can automate the following steps:
    cd lib && git clone https://github.com/microsoft/vscode.git
    checkout vscode -> ddc367e
    npm install 
    npm run build
