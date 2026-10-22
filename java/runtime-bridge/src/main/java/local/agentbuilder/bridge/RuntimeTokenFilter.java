package local.agentbuilder.bridge;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

@Component
public final class RuntimeTokenFilter extends OncePerRequestFilter {
    private final byte[] expected;
    public RuntimeTokenFilter(@Value("${builder.runtime-token}") String token) {
        if (token.length() < 24) throw new IllegalArgumentException("RUNTIME_TOKEN_NOT_CONFIGURED");
        expected = ("Bearer " + token).getBytes(StandardCharsets.UTF_8);
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header == null || !MessageDigest.isEqual(expected, header.getBytes(StandardCharsets.UTF_8))) {
            response.setStatus(401); response.setContentType("application/json");
            response.getWriter().write("{\"code\":\"RUNTIME_UNAUTHENTICATED\"}"); return;
        }
        chain.doFilter(request, response);
    }
}
