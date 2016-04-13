# hubot-sealand

Extension for your hubot which integrates with Rancher, Github and Docker Hub.

**NOTE:** if you don't want a services config rewritten add a `label` called
`codebot.dont_rewrite` and set it to `true`.

# HTTP API

* `/up`

    curl -XPOST localhost:8080/up -H 'Content-Type: application/json' -d '{
      "repo": "example/my-repo",
      "commitHash": "e3d6b46",
      "branch": "master",
      "composeFile": "docker-compose.yml"
    }'
