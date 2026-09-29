Feature: Greeting visitors

  Every scenario runs against the production lane: the built `build/`
  output served in-process. The runner (greeting.steps.ts, run directly by
  `pnpm test-bdd`) boots and releases its own server per scenario from the
  build `react-router build` made.

  Scenario Outline: The home page greets in the chosen language
    Given the app is using the <language> greeter
    When the app is running
    Then the home page says <expected>

    Examples:
      | language | expected |
      | en       | Hello!   |
      | es       | ¡Hola!   |

  Scenario Outline: The health check reports the configured greeter
    Given the app is using the <language> greeter
    When the app is running
    Then the health check says status ok and greeting <expected>

    Examples:
      | language | expected |
      | en       | Hello!   |
      | es       | ¡Hola!   |

  Scenario Outline: The docs endpoint describes the API
    Given the app is using the <language> greeter
    When the app is running
    Then the swagger docs and openapi document are served

    Examples:
      | language |
      | en       |

  Scenario Outline: The reveal counts the page view and the health check
    Given the app is using the en greeter
    When the app is running
    And a browser opens the home page
    And the health endpoint is hit
    And the reveal button is clicked
    Then the reveal reports greeting 2
