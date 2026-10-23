package local.agentbuilder.bridge;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class OperationIdTest {
    @Test void acceptsExistingCamelCaseEnterpriseOperationIds() {
        assertThat(BridgeApplication.validOperationId("getAccountBalance")).isTrue();
        assertThat(BridgeApplication.validOperationId("equipment-status")).isTrue();
    }

    @Test void keepsOperationIdsRestrictedToLowercaseLeadingAndSafeCharacters() {
        for (String invalid : new String[] {"GetAccountBalance", "get_account_balance", "../balance", ""})
            assertThat(BridgeApplication.validOperationId(invalid)).isFalse();
        assertThat(BridgeApplication.validOperationId(null)).isFalse();
    }
}
