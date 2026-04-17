package com.pfe.devsecops;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.pfe.devsecops.model.Task;
import com.pfe.devsecops.repository.TaskRepository;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class TaskControllerIntegrationTest {

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired TaskRepository taskRepository;

    @BeforeEach
    void setup() { taskRepository.deleteAll(); }

    @Test
    @Order(1)
    void shouldReturnEmptyList_whenNoTasks() throws Exception {
        mockMvc.perform(get("/api/tasks")
                .with(org.springframework.security.test.web.servlet.request
                        .SecurityMockMvcRequestPostProcessors.httpBasic("user","password")))
               .andExpect(status().isOk())
               .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    @Order(2)
    void shouldCreateTask_andReturn201() throws Exception {
        Task task = new Task();
        task.setTitle("Test Task");
        task.setDescription("Integration test task");

        mockMvc.perform(post("/api/tasks")
                .with(org.springframework.security.test.web.servlet.request
                        .SecurityMockMvcRequestPostProcessors.httpBasic("user","password"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(task)))
               .andExpect(status().isCreated())
               .andExpect(jsonPath("$.title", is("Test Task")))
               .andExpect(jsonPath("$.status", is("TODO")))
               .andExpect(jsonPath("$.id", notNullValue()));
    }

    @Test
    @Order(3)
    void shouldReturn400_whenTitleIsBlank() throws Exception {
        Task task = new Task();
        task.setTitle("");

        mockMvc.perform(post("/api/tasks")
                .with(org.springframework.security.test.web.servlet.request
                        .SecurityMockMvcRequestPostProcessors.httpBasic("user","password"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(task)))
               .andExpect(status().isBadRequest());
    }

    @Test
    @Order(4)
    void healthEndpoint_shouldBePublic() throws Exception {
        mockMvc.perform(get("/api/health"))
               .andExpect(status().isOk())
               .andExpect(jsonPath("$.status", is("UP")));
    }
}
