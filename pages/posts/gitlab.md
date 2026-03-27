---
title: How to keep GitLab CI manageable in a large monorepo
date: 2026-03-27
---

Over the past few years I've worked extensively on a large monorepo hosted on GitLab, and at points the experience has been genuinely painful. Pipelines have been a complex web that no human could reason about or safely change with confidence.

Benoit Couetil's [GitLab CI: 10+ Best Practices to Avoid Widespread Anti-Patterns](https://dev.to/zenika/gitlab-ci-10-best-practices-to-avoid-widespread-anti-patterns-2mb5) is the best single article I've found on GitLab CI. It shaped a lot of how I think about pipeline design, and I agree with nearly all of it. If you haven't read it, go do that first!

I want to revisit two of his recommendations through the lens of working in a large monorepo. On child pipelines, I've landed in a different place. On abstracting duplicated code, I mostly agree with his point — but I want to push it further and make a case for [CI/CD components](https://docs.gitlab.com/ci/components/) as the better tool for sharing configuration now that they've matured.

## Child pipelines are worth it

Couetil recommends avoiding child pipelines. His concerns — clunky UI, limited artifact sharing, added indirection — were valid when he wrote the article, and some of them still are. But in a monorepo with many services, I think child pipelines are essential.

Imagine a monorepo with several services, each with jobs flowing through `build → test → deploy_non_prod → integration_tests → deploy_to_prod`. In a single flat pipeline, all of those jobs share stages. If a test fails in one service, every other service is blocked, even if they're completely unrelated.

{% darkLightImg "/img/blog/gitlab/monolith", "svg", "A GitLab pipeline with four services sharing five stages: build, test, deploy_non_prod, integration_tests, and deploy_to_prod. Service A's test job has failed. All downstream jobs across all four services are blocked and shown as not started, even though the other three services' build and test jobs passed successfully." %}

In the above example, a test failure in one service has stopped the entire pipeline. The other three services built successfully and their tests would pass, but they can't progress because they're stuck behind a failure they have nothing to do with. You've coupled the release of unrelated services to each other's pipeline health.

### The `needs` trap

The natural reaction is to reach for `needs`. Wire up explicit dependencies between jobs so each service's build feeds into its own test, which feeds into its own deploy. Unrelated services can progress independently.

This helps with speed and isolation. But as you add services, the dependency graph grows fast — and with it, the mental overhead of understanding what depends on what.

{% darkLightImg "/img/blog/gitlab/needs", "svg", "The same four services, now wired with explicit needs dependencies instead of stages. Arrows connect each job to its dependencies, creating a dense web of relationships — particularly around shared integration_test and api_tests jobs, which fan out to multiple deploy_to_prod jobs. The graph is difficult to follow at a glance." %}

Every arrow here is a `needs` relationship. Imagine you're the person adding a new service, or introducing a dependency between two existing ones. You need to understand this entire graph to be confident you haven't missed something. A missed dependency means a deployment could run ahead of a test that should have gated it.

This is the stageless pipeline trap, and I've fallen into it firsthand — we'd traded stage-based coupling for cognitive overload.

### Isolation at the pipeline level

What we really want is the simplicity of stages but the isolation of our "needs" graph. With child pipelines, each service (or group of related services) gets its own isolated pipeline with its own stages. A failure in one child pipeline doesn't affect another.

{% darkLightImg "/img/blog/gitlab/child-pipeline", "svg", "The four services split into two child pipelines. Service A is in its own pipeline, outlined with a red dashed border — its test has failed and downstream jobs are blocked. Services B, C, and D are in a separate pipeline, outlined with a green dashed border — all their jobs have completed successfully through to production deployment, unaffected by service A's failure." %}

Each child pipeline is small. No one needs to hold a large dependency graph in their head.

The parent pipeline's job is simple: trigger the relevant children based on which files changed. We push most jobs down to the children.

Yes, the UI is still frustrating — waiting for a child pipeline to trigger, not seeing stages inline. It'd be nice if children loaded from the outset when the parent is created. GitLab has improved things, but it's still clunkier than I'd like. It's an inconvenience, but the trade-off for isolation is 100% worth it.

## Stop nesting `extends`

In the name of DRY code, some end up nesting extends several layers deep, obfuscating what a job is actually doing. You end up grepping across four files, trying to mentally merge YAML that was split apart to avoid repetition. And because extends let you override any field at any level, there's no way to constrain how someone uses a shared template. People override things they shouldn't, and the resulting behaviour is surprising.

I found a particularly incriminating example from a repo I've worked on:

```yaml
service_a_deploy_to_prod:
  extends:
    - .deploy_to_prod
  environment:
    name: service_a_prod
  needs:
    - service_a_build
    - service_a_deploy_to_staging
    - job: service_a_integration_test_staging
      optional: true
  variables:
    DOMAIN: services/service_a
    PROFILE: prod
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $CI_DEPLOY_FREEZE == null
      changes: !reference [.deploy_service_a_globs, changes]
```

To understand this job, you need to read `.deploy_to_prod` (itself a meaningless hop to add a level of indirection):

```yaml
.deploy_to_prod:
  extends: .deploy_to_prod_base
```

Which extends `.deploy_to_prod_base`:

```yaml
.deploy_to_prod_base:
  extends: .deploy_k8s
  stage: deploy_to_prod
  environment:
    name: prod
  variables:
    ENV: prod
    CLOUD_ROLE_ARN: $CLOUD_ROLE_ARN_PROD
    USE_VPN: "1"
    VPN_ENV: prod
```

Which extends `.deploy_k8s`:

```yaml
.deploy_k8s:
  tags: !reference [.runner, tags]
  image: $CI_REGISTRY_IMAGE/ci-deploy
  id_tokens:
    GITLAB_OIDC_TOKEN:
      aud: https://gitlab.com
  before_script:
    - !reference [.assume_cloud_role, before_script]
    - !reference [.enable_vpn, before_script]
    - if [[ $ENV == "default" ]]; then echo "Env not set"; exit 1; fi;
    - make -C infrastructure/k8s update_kubeconfig/$ENV
  script:
    - REPO_ROOT=$(pwd)
    - cd $DOMAIN
    - ${REPO_ROOT}/ci/shared/apply.sh
    - cd $REPO_ROOT
  variables:
    ENV: default
    GIT_STRATEGY: clone
```

That's four files. Three levels of inheritance. Any field can be overridden at any level. Good luck reviewing a change to `.deploy_k8s` and being confident about what it affects.

## Use CI/CD components instead

[CI/CD components](https://docs.gitlab.com/ci/components/) solve this more cleanly. A component is a reusable pipeline unit with typed inputs. Instead of inheriting and overriding, you call it with parameters.

Here's the same deployment expressed as a component:

```yaml
include:
  - component: $CI_SERVER_FQDN/$CI_PROJECT_PATH/kubernetes-deploy@$CI_COMMIT_SHA
    inputs:
      domain: services/service_a
      env: prod
      profile: prod
      cloud_role_arn: $CLOUD_ROLE_ARN_PROD
      vpn_env: prod
```

And the component itself:

```yaml
# templates/kubernetes-deploy.yml
spec:
  inputs:
    domain:
      type: string
    env:
      type: string
    profile:
      type: string
      default: ''
    cloud_role_arn:
      type: string
    vpn_env:
      type: string
---
deploy $[[ inputs.env ]] $[[ inputs.domain ]]:
  tags: !reference [.runner, tags]
  image: $CI_REGISTRY_IMAGE/ci-deploy
  stage: deploy_$[[ inputs.env ]]
  id_tokens:
    GITLAB_OIDC_TOKEN:
      aud: https://gitlab.com
  before_script:
    - !reference [.assume_cloud_role, before_script]
    - !reference [.enable_vpn, before_script]
    - if [[ $ENV == "default" ]]; then echo "Env not set"; exit 1; fi;
    - make -C infrastructure/k8s update_kubeconfig/$ENV
  script:
    - REPO_ROOT=$(pwd)
    - cd $DOMAIN
    - ${REPO_ROOT}/ci/shared/apply.sh
    - cd $REPO_ROOT
  variables:
    ENV: $[[ inputs.env ]]
    DOMAIN: $[[ inputs.domain ]]
    PROFILE: $[[ inputs.profile ]]
    CLOUD_ROLE_ARN: $[[ inputs.cloud_role_arn ]]
    GIT_STRATEGY: clone
    USE_VPN: "1"
    VPN_ENV: $[[ inputs.vpn_env ]]
```

The consumer sees five named inputs. The component author controls what's exposed. Nobody is silently overriding `before_script` three layers deep in a file you didn't know existed.

Components only went GA in GitLab 17.0, and they're still maturing. But they've already proven to be a much more understandable way to share pipeline configuration than the `extends` chains they replaced.

## Conclusion

None of this is settled wisdom. GitLab keeps shipping changes and improvements — I'm particularly excited to see where [Functions](https://docs.gitlab.com/ci/functions/) go.

If your monorepo has grown to the point where a failure in one service blocks another, or where understanding a single job means mentally reconstructing through a chain of extends clauses, these two changes should make a real difference.
