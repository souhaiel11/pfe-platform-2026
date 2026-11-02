import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;

public class Sec4eHttpProbe {
    public static void main(String[] args) throws Exception {
        var decoder = Base64.getDecoder();
        var encoder = Base64.getEncoder();
        var builder = HttpRequest.newBuilder(URI.create(args[1])).timeout(Duration.ofSeconds(15));
        byte[] body = decoder.decode(args[2]);
        builder.method(args[0], body.length == 0 ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofByteArray(body));
        for (int i = 3; i < args.length; i += 2) {
            builder.header(args[i], new String(decoder.decode(args[i + 1]), StandardCharsets.UTF_8));
        }
        var client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
        var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
        System.out.println("STATUS=" + response.statusCode());
        response.headers().map().forEach((name, values) -> values.forEach(value ->
                System.out.println("HEADER=" + name + ":" + encoder.encodeToString(value.getBytes(StandardCharsets.UTF_8)))));
        System.out.println("BODY=" + encoder.encodeToString(response.body()));
    }
}
